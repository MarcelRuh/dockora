import type { UpdateApplyResult, UpdateCheckResult, RegistryProvider } from '@dockora/shared';
import { isDockoraSelfContainer } from '../../domain/dockora-self.js';
import type { IDockerClient } from '../../domain/ports.js';
import { prisma } from '../../infrastructure/db/prisma.js';
import {
  apiRepositoryPath,
  detectRegistry,
  parseImageRef,
  pickDigest,
} from './registry.js';
import { request } from 'undici';
import type { ComposeService } from '../compose/compose.service.js';
import type Docker from 'dockerode';
import { waitForContainerHealthy } from './health-wait.js';

type RegistryAuth = {
  token: string;
  username: string;
};

export interface UpdatesServiceDeps {
  docker: IDockerClient;
  compose?: ComposeService;
  getRegistryAuth?: () => Promise<{ ghcrToken: string; lscrToken: string }>;
}

export class UpdatesService {
  constructor(private readonly deps: UpdatesServiceDeps) {}
  private pruneReadAt = 0;

  async listCached(): Promise<UpdateCheckResult[]> {
    await this.pruneStaleCacheThrottled();
    const rows = await prisma.updateCheckCache.findMany({
      orderBy: [{ updateAvailable: 'desc' }, { checkedAt: 'desc' }],
    });
    return rows.map(mapRow);
  }

  async countAvailable(): Promise<number> {
    await this.pruneStaleCacheThrottled();
    return prisma.updateCheckCache.count({
      where: { updateAvailable: true },
    });
  }

  async checkAll(allContainers = false): Promise<UpdateCheckResult[]> {
    const containers = (await this.deps.docker.listContainers(allContainers)).filter(
      (c) => !isDockoraSelfContainer(c),
    );
    const registryAuth = this.deps.getRegistryAuth
      ? await this.deps.getRegistryAuth()
      : undefined;
    const results: UpdateCheckResult[] = [];

    for (let i = 0; i < containers.length; i++) {
      const container = containers[i]!;
      // Stagger registry calls – GHCR anonymous/auth quotas are easy to trip in a burst
      if (i > 0) await sleep(750);
      try {
        const result = await this.checkContainer(
          container.id,
          container.name,
          container.image,
          registryAuth,
        );
        results.push(result);
        if (result.error?.toLowerCase().includes('rate limited')) {
          await sleep(5_000);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.toLowerCase().includes('rate limited')) {
          await sleep(5_000);
        }
        const fallback = await this.persistError(
          container.id,
          container.name,
          container.image,
          message,
        );
        results.push(fallback);
      }
    }

    // Alte Cache-Einträge (z. B. nach Recreate mit neuer Container-ID) entfernen
    await this.pruneStaleCache(containers.map((c) => c.id));

    return results;
  }

  private async pruneStaleCacheThrottled(): Promise<void> {
    if (Date.now() - this.pruneReadAt < 60_000) return;
    this.pruneReadAt = Date.now();
    await this.pruneStaleCache().catch(() => undefined);
  }

  private async resolveAuth(
    registryHost: string,
    creds?: { ghcrToken: string; lscrToken: string },
  ): Promise<RegistryAuth | undefined> {
    const resolved = creds ?? (this.deps.getRegistryAuth ? await this.deps.getRegistryAuth() : undefined);
    if (!resolved) return undefined;
    const host = registryHost.toLowerCase();
    if (host.includes('lscr.io')) {
      const token = resolved.lscrToken.trim() || resolved.ghcrToken.trim();
      return token ? { token, username: 'token' } : undefined;
    }
    if (host.includes('ghcr.io')) {
      const token = resolved.ghcrToken.trim();
      return token ? { token, username: 'token' } : undefined;
    }
    return undefined;
  }

  /**
   * Behält nur den aktuellen Stand: eine Zeile pro laufendem Container.
   * Verwaiste IDs und ältere Duplikate (gleicher Name) werden gelöscht.
   */
  private async pruneStaleCache(liveIds?: string[]): Promise<void> {
    let ids = liveIds;
    if (!ids) {
      const containers = (await this.deps.docker.listContainers(true)).filter(
        (c) => !isDockoraSelfContainer(c),
      );
      ids = containers.map((c) => c.id);
    }

    // Bei leerer Liste (Docker offline / Fehler) nichts löschen
    if (ids.length === 0) return;

    await prisma.updateCheckCache.deleteMany({
      where: { containerId: { notIn: ids } },
    });

    // Sicherheit: pro Container-Name nur den neuesten Check behalten
    const rows = await prisma.updateCheckCache.findMany({
      orderBy: { checkedAt: 'desc' },
      select: { containerId: true, containerName: true },
    });
    const seenNames = new Set<string>();
    const duplicateIds: string[] = [];
    for (const row of rows) {
      const key = row.containerName.replace(/^\//, '').toLowerCase();
      if (seenNames.has(key)) {
        duplicateIds.push(row.containerId);
      } else {
        seenNames.add(key);
      }
    }
    if (duplicateIds.length > 0) {
      await prisma.updateCheckCache.deleteMany({
        where: { containerId: { in: duplicateIds } },
      });
    }
  }

  async checkContainer(
    containerId: string,
    containerName: string,
    image: string,
    registryCreds?: { ghcrToken: string; lscrToken: string },
  ): Promise<UpdateCheckResult> {
    const parsed = parseImageRef(image);
    const registry = detectRegistry(image);

    let currentDigest: string | null = null;
    let remoteDigest: string | null = null;
    let error: string | undefined;

    try {
      const inspect = await this.deps.docker.getImageInspect(image);
      currentDigest = pickDigest(inspect.RepoDigests, parsed);
    } catch (err) {
      error = `Local inspect failed: ${err instanceof Error ? err.message : String(err)}`;
    }

    try {
      remoteDigest = await fetchRemoteDigest(
        parsed,
        await this.resolveAuth(parsed.registryHost, registryCreds),
      );
    } catch (err) {
      const remoteErr = err instanceof Error ? err.message : String(err);
      error = error ? `${error}; Remote: ${remoteErr}` : remoteErr;
    }

    const updateAvailable =
      Boolean(currentDigest && remoteDigest) && currentDigest !== remoteDigest;

    const row = await prisma.updateCheckCache.upsert({
      where: { containerId },
      create: {
        containerId,
        containerName,
        image,
        currentDigest,
        remoteDigest,
        updateAvailable,
        registry,
        currentTag: parsed.tag,
        error: error ?? null,
        checkedAt: new Date(),
      },
      update: {
        containerName,
        image,
        currentDigest,
        remoteDigest,
        updateAvailable,
        registry,
        currentTag: parsed.tag,
        error: error ?? null,
        checkedAt: new Date(),
      },
    });

    return mapRow(row);
  }

  /**
   * Pullt das Image, recreatet den Container, prüft Health und rollt bei Fail zurück.
   */
  async applyUpdate(containerId: string): Promise<UpdateApplyResult> {
    const cached = await prisma.updateCheckCache.findUnique({ where: { containerId } });
    if (!cached) {
      return { ok: false, message: 'No cached update info for container', step: 'pull' };
    }

    if (!cached.updateAvailable) {
      return { ok: false, message: 'No update available' };
    }

    const previousDigest = cached.currentDigest;
    const previousImage = cached.image;
    const remoteDigest = cached.remoteDigest;
    let composeProjectId: string | null = null;
    let composeServiceName: string | null = null;
    let containerName = cached.containerName;

    try {
      const before = await this.deps.docker.inspectContainer(containerId).catch(() => null);
      if (before) {
        containerName = before.name;
        composeServiceName = before.composeService ?? before.labels['com.docker.compose.service'] ?? null;
        if (before.composeProject && this.deps.compose) {
          const projects = await this.deps.compose.list();
          composeProjectId =
            projects.find((p) => p.name === before.composeProject)?.id ?? null;
        }
      }

      // Pull exact digest when known, but recreate with the original tag
      // (e.g. :latest) so Config.Image stays human-readable and matches compose YAML.
      const taggedRef = cached.image;
      const digestRef =
        remoteDigest && !taggedRef.includes('@')
          ? `${stripTag(taggedRef)}@${remoteDigest}`
          : null;
      const pullRef = digestRef ?? taggedRef;
      const runRef = taggedRef;

      await this.deps.docker.pullImage(pullRef).catch(async () => {
        await this.deps.docker.pullImage(taggedRef);
      });
      if (digestRef) {
        await this.deps.docker.tagImage(digestRef, runRef).catch(async () => {
          await this.deps.docker.tagImage(pullRef, runRef);
        });
      }

      let recreateMsg = '';
      if (composeProjectId && this.deps.compose && composeServiceName) {
        await this.deps.compose.recreatePinned(composeProjectId, {
          serviceName: composeServiceName,
          imageRef: runRef,
        });
        recreateMsg = ` Compose service "${composeServiceName}" recreated (${runRef}).`;
      } else if (composeProjectId && this.deps.compose) {
        await this.deps.compose.runAction(composeProjectId, 'recreate');
        recreateMsg = ' Compose project recreated.';
      } else {
        await recreateStandaloneContainer(this.deps.docker, containerId, runRef);
        recreateMsg = ' Standalone container recreated.';
      }

      const health = await waitForContainerHealthy(this.deps.docker, containerName);
      if (!health.ok) {
        const rolled = await this.rollbackUpdate({
          previousImage,
          previousDigest,
          composeProjectId,
          composeServiceName,
          containerName,
          containerId,
        });
        return {
          ok: false,
          rolledBack: true,
          step: 'rollback',
          message: `Update failed healthcheck: ${health.message}. ${rolled}`,
        };
      }

      // Cache aktualisieren
      try {
        const list = await this.deps.docker.listContainers(true);
        const current =
          list.find((c) => c.id === containerId || c.id.startsWith(containerId)) ??
          list.find((c) => c.name.replace(/^\//, '') === containerName.replace(/^\//, ''));
        if (current) {
          await this.checkContainer(current.id, current.name, current.image);
          if (current.id !== containerId) {
            await prisma.updateCheckCache.delete({ where: { containerId } }).catch(() => undefined);
          }
        } else {
          await prisma.updateCheckCache.update({
            where: { containerId },
            data: { updateAvailable: false, error: null, checkedAt: new Date() },
          });
        }
      } catch {
        await prisma.updateCheckCache
          .update({
            where: { containerId },
            data: { updateAvailable: false, checkedAt: new Date() },
          })
          .catch(() => undefined);
      }

      let prunedImages = 0;
      let spaceReclaimed = 0;
      try {
        const pruned = await this.deps.docker.pruneImages(true);
        prunedImages = pruned.imagesDeleted;
        spaceReclaimed = pruned.spaceReclaimed;
      } catch {
        // Prune ist best-effort – Update bleibt erfolgreich
      }

      const pruneMsg =
        prunedImages > 0
          ? ` Pruned ${prunedImages} unused image(s) (${Math.round(spaceReclaimed / (1024 * 1024))} MiB).`
          : '';

      return {
        ok: true,
        step: 'done',
        prunedImages,
        spaceReclaimed,
        message: `Image pulled.${recreateMsg} ${health.message}${pruneMsg}`,
      };
    } catch (error) {
      return {
        ok: false,
        step: 'pull',
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async rollbackUpdate(input: {
    previousImage: string;
    previousDigest: string | null;
    composeProjectId: string | null;
    composeServiceName: string | null;
    containerName: string;
    containerId: string;
  }): Promise<string> {
    try {
      const imageRef =
        input.previousDigest && !input.previousImage.includes('@')
          ? `${stripTag(input.previousImage)}@${input.previousDigest}`
          : input.previousImage;

      await this.deps.docker.pullImage(imageRef).catch(async () => {
        await this.deps.docker.pullImage(input.previousImage);
      });

      if (input.composeProjectId && this.deps.compose && input.composeServiceName) {
        await this.deps.compose.recreatePinned(input.composeProjectId, {
          serviceName: input.composeServiceName,
          imageRef,
        });
      } else if (input.composeProjectId && this.deps.compose) {
        await this.deps.compose.runAction(input.composeProjectId, 'recreate');
      } else {
        const list = await this.deps.docker.listContainers(true);
        const current =
          list.find((c) => c.name.replace(/^\//, '') === input.containerName.replace(/^\//, '')) ??
          list.find((c) => c.id.startsWith(input.containerId));
        if (current) {
          await recreateStandaloneContainer(this.deps.docker, current.id, imageRef);
        }
      }
      return `Rollback to previous image attempted (${imageRef}).`;
    } catch (error) {
      return `Rollback failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  private async persistError(
    containerId: string,
    containerName: string,
    image: string,
    message: string,
  ): Promise<UpdateCheckResult> {
    const parsed = parseImageRef(image);
    const row = await prisma.updateCheckCache.upsert({
      where: { containerId },
      create: {
        containerId,
        containerName,
        image,
        currentDigest: null,
        remoteDigest: null,
        updateAvailable: false,
        registry: parsed.registry,
        currentTag: parsed.tag,
        error: message,
        checkedAt: new Date(),
      },
      update: {
        containerName,
        image,
        error: message,
        checkedAt: new Date(),
      },
    });
    return mapRow(row);
  }
}

function mapRow(row: {
  containerId: string;
  containerName: string;
  image: string;
  currentDigest: string | null;
  remoteDigest: string | null;
  updateAvailable: boolean;
  registry: string;
  currentTag: string;
  error: string | null;
  checkedAt: Date;
}): UpdateCheckResult {
  return {
    containerId: row.containerId,
    containerName: row.containerName,
    image: row.image,
    currentDigest: row.currentDigest,
    remoteDigest: row.remoteDigest,
    updateAvailable: row.updateAvailable,
    registry: row.registry as RegistryProvider,
    currentTag: row.currentTag,
    checkedAt: row.checkedAt.toISOString(),
    error: row.error ?? undefined,
  };
}

async function fetchRemoteDigest(
  parsed: ReturnType<typeof parseImageRef>,
  auth?: RegistryAuth,
): Promise<string | null> {
  switch (parsed.registry) {
    case 'dockerhub':
      return fetchDockerHubDigest(parsed);
    case 'ghcr':
      return fetchOciDigest('ghcr.io', parsed, auth);
    case 'quay':
      return fetchOciDigest('quay.io', parsed, auth);
    case 'gitea':
    case 'gitlab':
    case 'private':
      return fetchOciDigest(parsed.registryHost, parsed, auth);
    default:
      return fetchOciDigest(parsed.registryHost, parsed, auth);
  }
}

async function fetchDockerHubDigest(
  parsed: ReturnType<typeof parseImageRef>,
): Promise<string | null> {
  const repoPath = apiRepositoryPath(parsed);
  const tokenUrl = `https://auth.docker.io/token?service=registry.docker.io&scope=repository:${repoPath}:pull`;
  const tokenRes = await request(tokenUrl, { signal: AbortSignal.timeout(10_000) });
  if (tokenRes.statusCode >= 400) {
    throw new Error(`Docker Hub auth failed (${tokenRes.statusCode})`);
  }
  const tokenBody = (await tokenRes.body.json()) as { token?: string; access_token?: string };
  const token = tokenBody.token ?? tokenBody.access_token;
  if (!token) {
    throw new Error('Docker Hub auth returned no token');
  }

  return fetchManifestDigest('registry-1.docker.io', repoPath, parsed.tag, { bearer: token });
}

async function fetchOciDigest(
  registryHost: string,
  parsed: ReturnType<typeof parseImageRef>,
  auth?: RegistryAuth,
): Promise<string | null> {
  const repoPath = apiRepositoryPath(parsed);
  return fetchManifestDigest(registryHost, repoPath, parsed.tag, { registryAuth: auth });
}

const MANIFEST_ACCEPT = [
  'application/vnd.oci.image.index.v1+json',
  'application/vnd.docker.distribution.manifest.list.v2+json',
  'application/vnd.oci.image.manifest.v1+json',
  'application/vnd.docker.distribution.manifest.v2+json',
].join(', ');

type ManifestAuth = {
  /** Pre-fetched bearer (e.g. Docker Hub anonymous token) */
  bearer?: string;
  registryAuth?: RegistryAuth;
};

interface WwwAuthChallenge {
  realm?: string;
  service?: string;
  scope?: string;
}

function isGhcrFamily(registryHost: string): boolean {
  const host = registryHost.toLowerCase();
  return host.includes('ghcr.io') || host.includes('lscr.io');
}

function defaultGhcrChallenge(repoPath: string): WwwAuthChallenge {
  return {
    realm: 'https://ghcr.io/token',
    service: 'ghcr.io',
    scope: `repository:${repoPath}:pull`,
  };
}

async function fetchManifestDigest(
  registryHost: string,
  repoPath: string,
  tag: string,
  auth?: ManifestAuth,
): Promise<string | null> {
  const url = `https://${registryHost}/v2/${repoPath}/manifests/${tag}`;
  const ref = `${registryHost}/${repoPath}:${tag}`;

  const attempt = async (bearer?: string) => {
    const headers: Record<string, string> = { Accept: MANIFEST_ACCEPT };
    if (bearer) headers.Authorization = `Bearer ${bearer}`;
    return request(url, { headers, signal: AbortSignal.timeout(10_000) });
  };

  const resolveBearer = async (
    challengeHint?: WwwAuthChallenge | null,
  ): Promise<string | null> => {
    let challenge = challengeHint ?? null;
    if (!challenge && isGhcrFamily(registryHost)) {
      challenge = defaultGhcrChallenge(repoPath);
    }
    if (!challenge) return null;
    return fetchRegistryBearerToken(challenge, repoPath, auth?.registryAuth);
  };

  // Prefer authenticated GHCR/LSCR access when a PAT is configured.
  // Anonymous GHCR quota is tiny – public 200s still count against it and cause 429s.
  let bearer = auth?.bearer;
  if (!bearer && auth?.registryAuth?.token && isGhcrFamily(registryHost)) {
    bearer = (await resolveBearer(defaultGhcrChallenge(repoPath))) ?? undefined;
  }

  let res = await attempt(bearer);
  let usedChallenge = Boolean(bearer && auth?.registryAuth?.token);

  const needsAuth =
    res.statusCode === 401 ||
    res.statusCode === 403 ||
    (res.statusCode === 404 && !bearer);

  if (needsAuth) {
    let challenge = parseWwwAuthenticate(res.headers['www-authenticate']);
    await res.body.dump().catch(() => undefined);

    if (!challenge) {
      const anon = await attempt(undefined);
      challenge = parseWwwAuthenticate(anon.headers['www-authenticate']);
      if (!challenge && anon.statusCode < 400) {
        res = anon;
      } else {
        await anon.body.dump().catch(() => undefined);
      }
    }

    const nextBearer = await resolveBearer(challenge);
    if (!nextBearer) {
      throw new Error(`Registry auth required (${ref})`);
    }
    usedChallenge = true;
    bearer = nextBearer;
    res = await attempt(bearer);
  }

  // Rate limit: backoff + authenticated retry (never stay on anonymous)
  for (let retry = 0; res.statusCode === 429 && retry < 3; retry++) {
    await res.body.dump().catch(() => undefined);
    await sleep(2_000 * (retry + 1));
    const challenge = parseWwwAuthenticate(res.headers['www-authenticate']);
    const nextBearer =
      (await resolveBearer(challenge)) ??
      (auth?.registryAuth?.token ? await resolveBearer(null) : null) ??
      bearer;
    if (nextBearer) {
      usedChallenge = true;
      bearer = nextBearer;
    }
    res = await attempt(bearer);
  }

  if (res.statusCode === 401 || res.statusCode === 403) {
    await res.body.dump().catch(() => undefined);
    throw new Error(
      usedChallenge
        ? `Registry auth required (${ref})`
        : `Registry auth required (${ref}) – check GHCR/LSCR token or leave empty for public images`,
    );
  }
  if (res.statusCode === 404) {
    await res.body.dump().catch(() => undefined);
    throw new Error(`Manifest not found (${ref})`);
  }
  if (res.statusCode === 429) {
    await res.body.dump().catch(() => undefined);
    throw new Error(`Registry rate limited (${ref})`);
  }
  if (res.statusCode >= 400) {
    const snippet = (await res.body.text().catch(() => '')).slice(0, 160).trim();
    throw new Error(
      `Manifest fetch failed (${res.statusCode}) for ${ref}${snippet ? `: ${snippet}` : ''}`,
    );
  }

  const digestHeader = res.headers['docker-content-digest'];
  if (typeof digestHeader === 'string') {
    await res.body.dump().catch(() => undefined);
    return digestHeader;
  }

  const body = (await res.body.json()) as {
    config?: { digest?: string };
    layers?: Array<{ digest?: string }>;
    manifests?: Array<{ digest?: string }>;
  };

  if (body.config?.digest) {
    return body.config.digest;
  }
  // OCI index / manifest list without Content-Digest header – use first child digest
  if (body.manifests?.[0]?.digest) {
    return body.manifests[0].digest;
  }

  return null;
}

function parseWwwAuthenticate(header: string | string[] | undefined): WwwAuthChallenge | null {
  const raw = Array.isArray(header) ? header.join(', ') : header;
  if (!raw) return null;
  // Prefer Bearer challenge if multiple schemes are present
  const bearerIdx = raw.search(/Bearer\s+/i);
  if (bearerIdx < 0) return null;
  const params = raw.slice(bearerIdx).replace(/^Bearer\s+/i, '');
  const out: WwwAuthChallenge = {};
  for (const part of params.split(',')) {
    const m = part.trim().match(/^(\w+)=(?:"([^"]*)"|([^,\s]+))/);
    if (!m) continue;
    const key = m[1]?.toLowerCase();
    const value = m[2] ?? m[3];
    if (key === 'realm') out.realm = value;
    if (key === 'service') out.service = value;
    if (key === 'scope') out.scope = value;
  }
  return out.realm ? out : null;
}

async function fetchRegistryBearerToken(
  challenge: WwwAuthChallenge | null,
  repoPath: string,
  registryAuth?: RegistryAuth,
): Promise<string | null> {
  if (!challenge?.realm) return null;

  const buildUrl = () => {
    const url = new URL(challenge.realm!);
    if (challenge.service) url.searchParams.set('service', challenge.service);
    url.searchParams.set('scope', challenge.scope ?? `repository:${repoPath}:pull`);
    return url.toString();
  };

  const requestToken = async (withCreds: boolean): Promise<string | null> => {
    const headers: Record<string, string> = {};
    if (withCreds && registryAuth?.token) {
      const basic = Buffer.from(`${registryAuth.username}:${registryAuth.token}`).toString(
        'base64',
      );
      headers.Authorization = `Basic ${basic}`;
    }
    try {
      const tokenRes = await request(buildUrl(), { headers, signal: AbortSignal.timeout(10_000) });
      if (tokenRes.statusCode >= 400) {
        await tokenRes.body.dump().catch(() => undefined);
        return null;
      }
      const body = (await tokenRes.body.json()) as { token?: string; access_token?: string };
      return body.token ?? body.access_token ?? null;
    } catch {
      return null;
    }
  };

  // Prefer credentials when present, but fall back to anonymous for public packages
  // (invalid PAT must not block linuxserver/ghcr public images).
  if (registryAuth?.token) {
    const withCreds = await requestToken(true);
    if (withCreds) return withCreds;
  }
  return requestToken(false);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function recreateStandaloneContainer(
  dockerClient: IDockerClient,
  containerId: string,
  imageOverride?: string,
): Promise<void> {
  const docker = dockerClient.getRaw() as Docker | null;
  if (!docker) {
    throw new Error('Docker offline – cannot recreate container');
  }

  const container = docker.getContainer(containerId);
  const info = await container.inspect();
  const name = info.Name?.replace(/^\//, '') || undefined;

  try {
    await container.stop({ t: 10 });
  } catch {
    // already stopped
  }
  await container.remove({ force: true });

  // Brief settle so docker-proxy can release host ports after force-remove
  await sleep(500);

  const createOpts = {
    name,
    Image: imageOverride || info.Config?.Image,
    Env: info.Config?.Env,
    Cmd: info.Config?.Cmd ?? undefined,
    Entrypoint: info.Config?.Entrypoint ?? undefined,
    WorkingDir: info.Config?.WorkingDir || undefined,
    Labels: info.Config?.Labels ?? undefined,
    ExposedPorts: info.Config?.ExposedPorts ?? undefined,
    HostConfig: info.HostConfig ?? undefined,
  };

  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await sleep(1_000 * attempt);
    try {
      // Remove a half-created leftover from a previous failed attempt
      if (attempt > 0 && name) {
        try {
          await docker.getContainer(name).remove({ force: true });
        } catch {
          // none
        }
      }
      const created = await docker.createContainer(createOpts);
      await created.start();
      return;
    } catch (error) {
      lastError = error;
      const msg = error instanceof Error ? error.message : String(error);
      if (!/port is already allocated|address already in use/i.test(msg)) {
        throw error;
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/** repo/name:tag → repo/name (für Digest-Pin). */
function stripTag(image: string): string {
  const withoutDigest = image.split('@')[0] ?? image;
  const lastSlash = withoutDigest.lastIndexOf('/');
  const lastColon = withoutDigest.lastIndexOf(':');
  if (lastColon > lastSlash) {
    return withoutDigest.slice(0, lastColon);
  }
  return withoutDigest;
}
