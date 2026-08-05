import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { APP_VERSION } from '@dockora/shared';
import { request } from 'undici';
import type Docker from 'dockerode';
import type { IDockerClient } from '../../domain/ports.js';
import { apiRepositoryPath, parseImageRef, pickDigest } from '../updates/registry.js';
import { SELF_UPDATE_APPLY_SCRIPT } from './self-update-apply.sh.js';

export type SelfUpdateMode = 'compose' | 'image' | 'none';

export interface SelfUpdateStatus {
  enabled: boolean;
  mode: SelfUpdateMode;
  currentVersion: string;
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
  /** Host-Pfad der Installation (Bind für Updater) */
  installDirHost: string | null;
  /** Pfad innerhalb des API-Containers zum Lesen von .dockora-revision */
  installDirMount: string | null;
  repo: string;
  branch: string;
  /** Optionaler Override der lokalen Revision (Compose-Env) */
  gitSha: string | null;
  /** Image-Modus (bestehend) */
  selfImage: string | null;
  updaterImage?: string;
}

const UPDATER_NAME = 'dockora-self-updater';
const DEFAULT_UPDATER_IMAGE = 'docker:27-cli';

/**
 * Self-Update für Dockora selbst:
 * - compose: GitHub-Commit prüfen, Source syncen, `docker compose up -d --build`
 * - image: DOCKORA_SELF_IMAGE pullen (Restart manuell / Compose)
 */
export class SelfUpdateService {
  private updating = false;

  constructor(
    private readonly docker: IDockerClient,
    private readonly options: SelfUpdateOptions,
  ) {}

  async status(): Promise<SelfUpdateStatus> {
    const compose = await this.composeStatus();
    if (compose.enabled) return compose;

    const image = await this.imageStatus();
    if (image.enabled) return image;

    return {
      enabled: false,
      mode: 'none',
      currentVersion: APP_VERSION,
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
      updating: this.updating,
    };
  }

  async apply(): Promise<SelfUpdateApplyResult> {
    if (this.updating) {
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

  private async composeStatus(): Promise<SelfUpdateStatus> {
    const hostDir = this.options.installDirHost;
    const mount = this.options.installDirMount ?? hostDir;
    const base: SelfUpdateStatus = {
      enabled: false,
      mode: 'compose',
      currentVersion: APP_VERSION,
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
      updating: this.updating,
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
      return {
        ...base,
        enabled: true,
        localRevision,
        remoteRevision: null,
        message: `GitHub-Check fehlgeschlagen: ${error instanceof Error ? error.message : String(error)}`,
      };
    }

    const updateAvailable = Boolean(
      remoteRevision && (!localRevision || !revisionsMatch(localRevision, remoteRevision)),
    );

    return {
      ...base,
      enabled: true,
      localRevision,
      remoteRevision,
      updateAvailable,
      message: this.updating
        ? 'Update läuft – Stack wird neu gebaut…'
        : updateAvailable
          ? 'Update verfügbar – Source von GitHub holen und Stack neu bauen'
          : 'Up to date',
    };
  }

  private async imageStatus(): Promise<SelfUpdateStatus> {
    const image = this.options.selfImage;
    const base: SelfUpdateStatus = {
      enabled: false,
      mode: 'image',
      currentVersion: APP_VERSION,
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
      updating: this.updating,
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
    if (!hostDir) {
      return { ok: false, message: 'DOCKORA_INSTALL_DIR ist nicht gesetzt', mode: 'compose' };
    }

    this.updating = true;
    try {
      const raw = this.docker.getRaw() as Docker;
      const updaterImage = this.options.updaterImage ?? DEFAULT_UPDATER_IMAGE;

      await pullImageQuiet(raw, updaterImage);

      try {
        const existing = raw.getContainer(UPDATER_NAME);
        await existing.remove({ force: true });
      } catch {
        // not present
      }

      const container = await raw.createContainer({
        name: UPDATER_NAME,
        Image: updaterImage,
        Cmd: ['sh', '-c', SELF_UPDATE_APPLY_SCRIPT],
        Env: [
          'DOCKORA_INSTALL_DIR=/install',
          `DOCKORA_REPO=${this.options.repo}`,
          `DOCKORA_UPDATE_BRANCH=${this.options.branch}`,
        ],
        WorkingDir: '/install',
        HostConfig: {
          Binds: [
            `${hostDir}:/install`,
            '/var/run/docker.sock:/var/run/docker.sock',
          ],
          AutoRemove: true,
        },
        Labels: {
          'dockora.update': 'self',
        },
      });

      await container.start();

      return {
        ok: true,
        mode: 'compose',
        message:
          'Update gestartet. Dockora wird kurz neu gebaut und neu gestartet – Seite in 1–2 Minuten neu laden.',
      };
    } catch (error) {
      this.updating = false;
      return {
        ok: false,
        mode: 'compose',
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async applyImage(): Promise<SelfUpdateApplyResult> {
    const image = this.options.selfImage;
    if (!image) {
      return { ok: false, message: 'DOCKORA_SELF_IMAGE ist nicht gesetzt', mode: 'image' };
    }

    try {
      await this.docker.pullImage(image);
      const after = await this.imageStatus();
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
}

export function readLocalRevision(mountDir: string, envSha: string | null): string | null {
  if (envSha?.trim()) return envSha.trim();
  const file = path.join(mountDir, '.dockora-revision');
  if (!existsSync(file)) return null;
  try {
    const value = readFileSync(file, 'utf8').trim();
    return value || null;
  } catch {
    return null;
  }
}

export function revisionsMatch(local: string, remote: string): boolean {
  const a = local.trim().toLowerCase();
  const b = remote.trim().toLowerCase();
  if (a === b) return true;
  // short SHA vs full
  if (a.length >= 7 && b.length >= 7 && (a.startsWith(b) || b.startsWith(a))) return true;
  return false;
}

export async function fetchGithubCommitSha(repo: string, branch: string): Promise<string> {
  const url = `https://api.github.com/repos/${repo}/commits/${encodeURIComponent(branch)}`;
  const res = await request(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'dockora-self-update',
    },
  });
  if (res.statusCode >= 400) {
    throw new Error(`GitHub API ${res.statusCode}`);
  }
  const body = (await res.body.json()) as { sha?: string };
  if (!body.sha || !/^[a-f0-9]{7,40}$/i.test(body.sha)) {
    throw new Error('Ungültige GitHub-Antwort (kein SHA)');
  }
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
