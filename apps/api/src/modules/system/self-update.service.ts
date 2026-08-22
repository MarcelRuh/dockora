import { existsSync, readFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { APP_VERSION } from '@dockora/shared';
import { request } from 'undici';
import type Docker from 'dockerode';
import type { IDockerClient } from '../../domain/ports.js';
import { apiRepositoryPath, parseImageRef, pickDigest } from '../updates/registry.js';
import { SELF_UPDATE_APPLY_SCRIPT } from './self-update-apply.sh.js';

const execFileAsync = promisify(execFile);

export type SelfUpdateMode = 'compose' | 'image' | 'none';

export interface SelfUpdateStatus {
  enabled: boolean;
  mode: SelfUpdateMode;
  currentVersion: string;
  sourceVersion: string | null;
  localRevision: string | null;
  remoteRevision: string | null;
  image: string | null;
  currentDigest: string | null;
  remoteDigest: string | null;
  updateAvailable: boolean;
  message: string;
  installDir: string | null;
  repo: string | null;
  branch: string | null;
  updating: boolean;
}

export interface SelfUpdateApplyResult {
  ok: boolean;
  message: string;
  mode: SelfUpdateMode;
}

export interface SelfUpdateOptions {
  installDirHost: string | null;
  installDirMount: string | null;
  repo: string;
  branch: string;
  gitSha: string | null;
  selfImage: string | null;
  updaterImage?: string;
}

const UPDATER_NAME = 'dockora-self-updater';
const DEFAULT_UPDATER_IMAGE = 'docker:27-cli';
const APPLY_TIMEOUT_MS = 20 * 60 * 1000;

/**
 * Self-Update für Dockora selbst:
 * - compose: GitHub-Commit prüfen, Source syncen (+ optional compose rebuild)
 * - image: DOCKORA_SELF_IMAGE pullen
 */
export class SelfUpdateService {
  /** Kurzer Optimistic-Lock, damit Doppelklicks nicht parallel starten */
  private applyInFlight = false;

  constructor(
    private readonly docker: IDockerClient,
    private readonly options: SelfUpdateOptions,
  ) {}

  async status(): Promise<SelfUpdateStatus> {
    const updating = this.applyInFlight || (await this.isUpdaterRunning());

    const compose = await this.composeStatus(updating);
    if (compose.enabled) return compose;

    const image = await this.imageStatus(updating);
    if (image.enabled) return image;

    return {
      enabled: false,
      mode: 'none',
      currentVersion: APP_VERSION,
      sourceVersion: null,
      localRevision: null,
      remoteRevision: null,
      image: null,
      currentDigest: null,
      remoteDigest: null,
      updateAvailable: false,
      message:
        'Self-Update nicht verfügbar. Setze DOCKORA_INSTALL_DIR (Compose-Install) oder DOCKORA_SELF_IMAGE.',
      installDir: this.options.installDirHost,
      repo: this.options.repo,
      branch: this.options.branch,
      updating,
    };
  }

  async apply(): Promise<SelfUpdateApplyResult> {
    if (this.applyInFlight || (await this.isUpdaterRunning())) {
      return { ok: false, message: 'Update läuft bereits', mode: 'compose' };
    }

    const status = await this.status();
    if (!status.enabled) {
      return { ok: false, message: status.message, mode: status.mode };
    }

    if (status.mode === 'compose') {
      return this.applyCompose();
    }
    if (status.mode === 'image') {
      return this.applyImage();
    }
    return { ok: false, message: 'Kein Update-Modus aktiv', mode: 'none' };
  }

  private async composeStatus(updating: boolean): Promise<SelfUpdateStatus> {
    const hostDir = this.options.installDirHost;
    const mount = this.options.installDirMount ?? hostDir;
    const sourceVersion = mount ? readSourceVersion(mount) : null;
    const base: SelfUpdateStatus = {
      enabled: false,
      mode: 'compose',
      currentVersion: APP_VERSION,
      sourceVersion,
      localRevision: null,
      remoteRevision: null,
      image: null,
      currentDigest: null,
      remoteDigest: null,
      updateAvailable: false,
      message: '',
      installDir: hostDir,
      repo: this.options.repo,
      branch: this.options.branch,
      updating,
    };

    if (!hostDir || !mount) {
      return base;
    }

    const composeFile = path.join(mount, 'docker-compose.yml');
    if (!existsSync(composeFile)) {
      return {
        ...base,
        message: `Installationsverzeichnis nicht gemountet oder ungültig (${mount})`,
      };
    }

    const localRevision = readLocalRevision(mount, this.options.gitSha);
    let remoteRevision: string | null = null;

    try {
      remoteRevision = await fetchGithubCommitSha(this.options.repo, this.options.branch);
    } catch (error) {
      const versionDrift = Boolean(sourceVersion && sourceVersion !== APP_VERSION);
      return {
        ...base,
        enabled: true,
        localRevision,
        remoteRevision: null,
        updateAvailable: versionDrift,
        message: versionDrift
          ? `GitHub-Check fehlgeschlagen (${error instanceof Error ? error.message : String(error)}). Laufende Version ${APP_VERSION} ≠ Source ${sourceVersion} – Rebuild möglich.`
          : `GitHub-Check fehlgeschlagen: ${error instanceof Error ? error.message : String(error)}`,
      };
    }

    const updateAvailable = isSelfUpdateAvailable({
      deployedRevision: localRevision,
      remoteRevision,
      runningVersion: APP_VERSION,
      sourceVersion,
    });

    return {
      ...base,
      enabled: true,
      localRevision,
      remoteRevision,
      updateAvailable,
      message: updating
        ? 'Update läuft…'
        : updateAvailable
          ? sourceVersion && sourceVersion !== APP_VERSION
            ? `Update verfügbar – Rebuild ${APP_VERSION} → ${sourceVersion}`
            : 'Update verfügbar – Source von GitHub holen und anwenden'
          : 'Up to date',
    };
  }

  private async imageStatus(updating: boolean): Promise<SelfUpdateStatus> {
    const image = this.options.selfImage;
    const base: SelfUpdateStatus = {
      enabled: false,
      mode: 'image',
      currentVersion: APP_VERSION,
      sourceVersion: null,
      localRevision: null,
      remoteRevision: null,
      image,
      currentDigest: null,
      remoteDigest: null,
      updateAvailable: false,
      message: '',
      installDir: this.options.installDirHost,
      repo: this.options.repo,
      branch: this.options.branch,
      updating,
    };

    if (!image) return base;

    const parsed = parseImageRef(image);
    let currentDigest: string | null = null;
    let remoteDigest: string | null = null;
    let message = 'Up to date';

    try {
      const inspect = await this.docker.getImageInspect(image);
      currentDigest = pickDigest(inspect.RepoDigests, parsed);
    } catch {
      message = 'Lokales Image nicht gefunden – Pull erforderlich';
    }

    try {
      remoteDigest = await fetchRemoteDigestSimple(parsed);
    } catch (error) {
      return {
        ...base,
        enabled: true,
        currentDigest,
        remoteDigest: null,
        message: `Remote-Check fehlgeschlagen: ${error instanceof Error ? error.message : String(error)}`,
      };
    }

    const updateAvailable =
      Boolean(remoteDigest && currentDigest && remoteDigest !== currentDigest) ||
      (!currentDigest && Boolean(remoteDigest));

    return {
      ...base,
      enabled: true,
      currentDigest,
      remoteDigest,
      updateAvailable,
      message: updateAvailable
        ? 'Update verfügbar – Pull ausführen, danach Dockora-Stack neu starten'
        : message,
    };
  }

  private async applyCompose(): Promise<SelfUpdateApplyResult> {
    const hostDir = this.options.installDirHost;
    const mount = this.options.installDirMount ?? hostDir;
    if (!hostDir || !mount) {
      return { ok: false, message: 'DOCKORA_INSTALL_DIR ist nicht gesetzt', mode: 'compose' };
    }

    this.applyInFlight = true;
    try {
      // Host/Dev (API nicht in Docker): Dateien syncen, kein compose rebuild
      if (!existsSync('/.dockerenv')) {
        return await this.applyOnHost(mount);
      }
      return await this.applyViaUpdaterContainer(hostDir);
    } finally {
      this.applyInFlight = false;
    }
  }

  private async applyOnHost(installMount: string): Promise<SelfUpdateApplyResult> {
    const scriptPath = path.join(installMount, 'scripts', 'self-update-apply.sh');
    try {
      if (existsSync(scriptPath)) {
        const { stdout, stderr } = await execFileAsync('sh', [scriptPath], {
          env: {
            ...process.env,
            DOCKORA_INSTALL_DIR: installMount,
            DOCKORA_REPO: this.options.repo,
            DOCKORA_UPDATE_BRANCH: this.options.branch,
            DOCKORA_SKIP_COMPOSE: '1',
            ...(githubToken() ? { GITHUB_TOKEN: githubToken() as string } : {}),
          },
          timeout: APPLY_TIMEOUT_MS,
          maxBuffer: 4 * 1024 * 1024,
        });
        const tail = `${stdout}\n${stderr}`.trim().split('\n').slice(-6).join('\n');
        return {
          ok: true,
          mode: 'compose',
          message: `Dateien aktualisiert (Host/Dev). API ggf. neu starten.\n${tail}`,
        };
      }

      // Fallback: embedded script via sh -c
      const { stdout, stderr } = await execFileAsync('sh', ['-c', SELF_UPDATE_APPLY_SCRIPT], {
        env: {
          ...process.env,
          DOCKORA_INSTALL_DIR: installMount,
          DOCKORA_REPO: this.options.repo,
          DOCKORA_UPDATE_BRANCH: this.options.branch,
          DOCKORA_SKIP_COMPOSE: '1',
          ...(githubToken() ? { GITHUB_TOKEN: githubToken() as string } : {}),
        },
        timeout: APPLY_TIMEOUT_MS,
        maxBuffer: 4 * 1024 * 1024,
      });
      const tail = `${stdout}\n${stderr}`.trim().split('\n').slice(-6).join('\n');
      return {
        ok: true,
        mode: 'compose',
        message: `Dateien aktualisiert (Host/Dev). API ggf. neu starten.\n${tail}`,
      };
    } catch (error) {
      const err = error as { message?: string; stdout?: string; stderr?: string };
      return {
        ok: false,
        mode: 'compose',
        message: [err.message, err.stderr, err.stdout].filter(Boolean).join('\n') || String(error),
      };
    }
  }

  private async applyViaUpdaterContainer(hostDir: string): Promise<SelfUpdateApplyResult> {
    try {
      const raw = this.docker.getRaw() as Docker;
      const updaterImage = this.options.updaterImage ?? DEFAULT_UPDATER_IMAGE;

      await pullImageQuiet(raw, updaterImage);

      try {
        await raw.getContainer(UPDATER_NAME).remove({ force: true });
      } catch {
        // not present
      }

      // Bind host path → same path inside updater. Compose bind-mounts are
      // resolved by the Docker daemon on the host; a remount as /install breaks
      // relative volumes (nginx.conf) and leaks DOCKORA_INSTALL_DIR=/install.
      const rawApplyUrl = `https://raw.githubusercontent.com/${this.options.repo}/${this.options.branch}/scripts/self-update-apply.sh`;
      const token = githubToken();
      const container = await raw.createContainer({
        name: UPDATER_NAME,
        Image: updaterImage,
        Cmd: [
          'sh',
          '-c',
          `if wget -qO /tmp/dockora-apply.sh ${JSON.stringify(rawApplyUrl)}; then exec sh /tmp/dockora-apply.sh; fi\n` +
            `echo "WARN: could not download apply script, using embedded fallback" >&2\n` +
            SELF_UPDATE_APPLY_SCRIPT,
        ],
        Env: [
          `DOCKORA_INSTALL_DIR=${hostDir}`,
          `DOCKORA_REPO=${this.options.repo}`,
          `DOCKORA_UPDATE_BRANCH=${this.options.branch}`,
          'DOCKORA_SKIP_COMPOSE=0',
          ...(token ? [`GITHUB_TOKEN=${token}`] : []),
        ],
        WorkingDir: hostDir,
        HostConfig: {
          Binds: [`${hostDir}:${hostDir}`, '/var/run/docker.sock:/var/run/docker.sock'],
          AutoRemove: false,
        },
        Labels: {
          'dockora.update': 'self',
        },
      });

      await container.start();

      // Fire-and-forget: waiting here blocks the API/UI for the full rebuild and
      // dies when compose recreates the API container mid-request.
      void this.finalizeUpdater(container).catch(() => {
        // best-effort cleanup; status.updating reflects container state
      });

      return {
        ok: true,
        mode: 'compose',
        message:
          'Update gestartet. Source wird synchronisiert und der Stack neu gebaut – Status aktualisiert sich automatisch.',
      };
    } catch (error) {
      return {
        ok: false,
        mode: 'compose',
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async finalizeUpdater(container: Docker.Container): Promise<void> {
    try {
      await Promise.race([
        container.wait(),
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('Update-Timeout (20 Min.)')), APPLY_TIMEOUT_MS);
        }),
      ]);
    } catch {
      try {
        await container.remove({ force: true });
      } catch {
        // ignore
      }
      return;
    }

    try {
      await container.remove({ force: true });
    } catch {
      // ignore – may already be gone after compose recreate
    }
  }

  private async applyImage(): Promise<SelfUpdateApplyResult> {
    const image = this.options.selfImage;
    if (!image) {
      return { ok: false, message: 'DOCKORA_SELF_IMAGE ist nicht gesetzt', mode: 'image' };
    }

    try {
      await this.docker.pullImage(image);
      const after = await this.imageStatus(false);
      return {
        ok: true,
        mode: 'image',
        message: `Image ${image} aktualisiert (${after.currentDigest?.slice(0, 19) ?? 'ok'}). Bitte Dockora neu starten (compose up -d).`,
      };
    } catch (error) {
      return {
        ok: false,
        mode: 'image',
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async isUpdaterRunning(): Promise<boolean> {
    try {
      const raw = this.docker.getRaw() as Docker;
      const info = await raw.getContainer(UPDATER_NAME).inspect();
      return Boolean(info.State?.Running);
    } catch {
      return false;
    }
  }
}

export function readLocalRevision(mountDir: string, envSha: string | null): string | null {
  if (envSha?.trim()) return envSha.trim();

  // Deployed revision written after a successful compose rebuild / install.
  // Do not use git HEAD: the working tree can already match GitHub while
  // running containers are still the previous build.
  const file = path.join(mountDir, '.dockora-revision');
  if (existsSync(file)) {
    try {
      const value = readFileSync(file, 'utf8').trim();
      if (value) return value;
    } catch {
      // fall through to git HEAD
    }
  }

  return readGitHead(mountDir);
}

export function readGitHead(mountDir: string): string | null {
  const gitHead = path.join(mountDir, '.git', 'HEAD');
  if (!existsSync(gitHead)) return null;
  try {
    const head = readFileSync(gitHead, 'utf8').trim();
    if (/^[a-f0-9]{7,40}$/i.test(head)) return head;
    const refMatch = /^ref:\s*(.+)$/.exec(head);
    if (refMatch?.[1]) {
      const refPath = path.join(mountDir, '.git', refMatch[1]);
      if (existsSync(refPath)) {
        const sha = readFileSync(refPath, 'utf8').trim();
        if (/^[a-f0-9]{7,40}$/i.test(sha)) return sha;
      }
    }
  } catch {
    return null;
  }
  return null;
}

export function readSourceVersion(mountDir: string): string | null {
  const file = path.join(mountDir, 'package.json');
  if (!existsSync(file)) return null;
  try {
    const pkg = JSON.parse(readFileSync(file, 'utf8')) as { version?: unknown };
    return typeof pkg.version === 'string' && pkg.version.trim() ? pkg.version.trim() : null;
  } catch {
    return null;
  }
}

export function isSelfUpdateAvailable(opts: {
  deployedRevision: string | null;
  remoteRevision: string | null;
  runningVersion: string;
  sourceVersion: string | null;
}): boolean {
  if (
    opts.remoteRevision &&
    (!opts.deployedRevision || !revisionsMatch(opts.deployedRevision, opts.remoteRevision))
  ) {
    return true;
  }
  if (opts.sourceVersion && opts.sourceVersion !== opts.runningVersion) {
    return true;
  }
  return false;
}

export function revisionsMatch(local: string, remote: string): boolean {
  const a = local.trim().toLowerCase();
  const b = remote.trim().toLowerCase();
  if (a === b) return true;
  if (a.length >= 7 && b.length >= 7 && (a.startsWith(b) || b.startsWith(a))) return true;
  return false;
}

function githubToken(): string | null {
  const token = process.env.GITHUB_TOKEN?.trim() || process.env.GH_TOKEN?.trim() || '';
  return token || null;
}

let githubShaCache: { key: string; sha: string; at: number } | null = null;
const GITHUB_SHA_CACHE_MS = 60_000;

export async function fetchGithubCommitSha(repo: string, branch: string): Promise<string> {
  const key = `${repo}@${branch}`;
  const now = Date.now();
  if (githubShaCache && githubShaCache.key === key && now - githubShaCache.at < GITHUB_SHA_CACHE_MS) {
    return githubShaCache.sha;
  }

  const url = `https://api.github.com/repos/${repo}/commits/${encodeURIComponent(branch)}`;
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'dockora-self-update',
  };
  const token = githubToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await request(url, { headers });
  if (res.statusCode >= 400) {
    throw new Error(`GitHub API ${res.statusCode}`);
  }
  const body = (await res.body.json()) as { sha?: string };
  if (!body.sha || !/^[a-f0-9]{7,40}$/i.test(body.sha)) {
    throw new Error('Ungültige GitHub-Antwort (kein SHA)');
  }
  githubShaCache = { key, sha: body.sha, at: now };
  return body.sha;
}

async function pullImageQuiet(docker: Docker, image: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    docker.pull(image, (err: Error | null, stream: NodeJS.ReadableStream) => {
      if (err) {
        reject(err);
        return;
      }
      docker.modem.followProgress(stream, (followErr: Error | null) => {
        if (followErr) reject(followErr);
        else resolve();
      });
    });
  });
}

async function fetchRemoteDigestSimple(
  parsed: ReturnType<typeof parseImageRef>,
): Promise<string | null> {
  const repoPath = apiRepositoryPath(parsed);
  let registryHost = parsed.registryHost || 'registry-1.docker.io';
  let token: string | undefined;

  if (parsed.registry === 'dockerhub') {
    registryHost = 'registry-1.docker.io';
    const tokenUrl = `https://auth.docker.io/token?service=registry.docker.io&scope=repository:${repoPath}:pull`;
    const tokenRes = await request(tokenUrl);
    if (tokenRes.statusCode < 400) {
      const body = (await tokenRes.body.json()) as { token?: string; access_token?: string };
      token = body.token ?? body.access_token;
    }
  } else {
    try {
      const tokenUrl = `https://${registryHost}/token?service=${registryHost}&scope=repository:${repoPath}:pull`;
      const tokenRes = await request(tokenUrl);
      if (tokenRes.statusCode < 400) {
        const body = (await tokenRes.body.json()) as { token?: string; access_token?: string };
        token = body.token ?? body.access_token;
      }
    } catch {
      // anonymous
    }
  }

  const url = `https://${registryHost}/v2/${repoPath}/manifests/${parsed.tag}`;
  const headers: Record<string, string> = {
    Accept:
      'application/vnd.docker.distribution.manifest.v2+json, application/vnd.oci.image.manifest.v1+json',
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await request(url, { headers });
  if (res.statusCode >= 400) {
    throw new Error(`Manifest fetch failed (${res.statusCode})`);
  }
  const digestHeader = res.headers['docker-content-digest'];
  return typeof digestHeader === 'string' ? digestHeader : null;
}
