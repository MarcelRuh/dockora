import type { UpdateApplyResult, UpdateCheckResult, RegistryProvider } from '@dockora/shared';
import { isDockoraSelfContainer } from '../../domain/dockora-self.js';
import type { IDockerClient, RegistryPullAuth } from '../../domain/ports.js';
import { prisma } from '../../infrastructure/db/prisma.js';
import {
  apiRepositoryPath,
  detectRegistry,
  parseImageRef,
  pickDigest,
} from './registry.js';
import { createHash } from 'node:crypto';
import { request } from 'undici';
import type { ComposeService } from '../compose/compose.service.js';
import type Docker from 'dockerode';
import { mergeRemoteCheck } from './digest-fallback.js';
import { waitForContainerHealthy } from './health-wait.js';
import { isImageIdRef } from '../../domain/image-ref.js';

type RegistryAuth = {
  token: string;
  username: string;
};

export interface UpdatesServiceDeps {
  docker: IDockerClient;
  compose?: ComposeService;
  getRegistryAuth?: () => Promise<{ ghcrToken: string; lscrToken: string }>;
}

// Shared across UpdatesService instances (HTTP routes and the scheduler each build one).
const applyInFlight = new Set<string>();
/** containerName → remote digest whose update failed its healthcheck and was rolled back. */
const rolledBackDigests = new Map<string, string>();

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
    const remoteByImage = new Map<string, Promise<string | null>>();

    let lastRegistryCallAt = 0;
    for (const container of containers) {
      // Stagger registry calls – GHCR anonymous/auth quotas are easy to trip in a burst.
      // Containers sharing an already-fetched image reuse the in-flight digest and skip the wait.
      if (!remoteByImage.has(remoteCacheKey(container.image)) && !isImageIdRef(container.image)) {
        const wait = 750 - (Date.now() - lastRegistryCallAt);
        if (lastRegistryCallAt > 0 && wait > 0) await sleep(wait);
        lastRegistryCallAt = Date.now();
      }
      try {
        const result = await this.checkContainer(container, registryAuth, remoteByImage);
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
    container: { id: string; name: string; image: string; imageId?: string },
    registryCreds?: { ghcrToken: string; lscrToken: string },
    remoteByImage?: Map<string, Promise<string | null>>,
  ): Promise<UpdateCheckResult> {
    const { id: containerId, name: containerName, image } = container;
    if (isImageIdRef(image)) {
      // No tag to compare against: the container was created from a bare image ID.
      return this.persistError(
        containerId,
        containerName,
        image,
        'Container references an image ID, not a tag – recreate it from its compose file or a tagged image to enable update checks',
      );
    }
    const parsed = parseImageRef(image);
    const registry = detectRegistry(image);
    const previous = await prisma.updateCheckCache.findUnique({ where: { containerId } });

    let currentDigest: string | null = null;
    let error: string | undefined;

    try {
      // Inspect the image the container actually runs. The tag may already point to a newer
      // pull (update pulled but not yet recreated) – that must still count as "update available".
      let inspect = container.imageId
        ? await this.deps.docker.getImageInspect(container.imageId).catch(() => null)
        : null;
      inspect ??= await this.deps.docker.getImageInspect(image);
      currentDigest = pickDigest(inspect.RepoDigests, parsed);
    } catch (err) {
      error = `Local inspect failed: ${err instanceof Error ? err.message : String(err)}`;
    }

    let fetchedDigest: string | null = null;
    let remoteError: string | undefined;
    try {
      const auth = await this.resolveAuth(parsed.registryHost, registryCreds);
      const cacheKey = remoteCacheKey(image);
      const load = remoteByImage?.get(cacheKey) ?? fetchRemoteDigest(parsed, auth);
      remoteByImage?.set(cacheKey, load);
      fetchedDigest = await load;
    } catch (err) {
      remoteByImage?.delete(remoteCacheKey(image));
      remoteError = err instanceof Error ? err.message : String(err);
    }

    const merged = mergeRemoteCheck({
      previousRemoteDigest: previous?.remoteDigest ?? null,
      fetchedDigest,
      remoteError,
    });
    const remoteDigest = merged.remoteDigest;
    if (merged.error) {
      error = error ? `${error}; Remote: ${merged.error}` : merged.error;
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
   * `opts.auto` (scheduler) skips a remote digest that already failed and was rolled back,
   * so a broken upstream release is not re-applied (and the service restarted) every cycle.
   */
  async applyUpdate(containerId: string, opts?: { auto?: boolean }): Promise<UpdateApplyResult> {
    if (applyInFlight.has(containerId)) {
      return { ok: false, message: 'Update already in progress for this container', step: 'pull' };
    }
    applyInFlight.add(containerId);
    try {
      return await this.applyUpdateLocked(containerId, opts);
    } finally {
      applyInFlight.delete(containerId);
    }
  }

  private async applyUpdateLocked(
    containerId: string,
    opts?: { auto?: boolean },
  ): Promise<UpdateApplyResult> {
    const cachedRow = await prisma.updateCheckCache.findUnique({ where: { containerId } });
    if (!cachedRow) {
      return { ok: false, message: 'No cached update info for container', step: 'pull' };
    }

    const before = await this.deps.docker.inspectContainer(containerId).catch(() => null);
    if (!before) {
      return { ok: false, message: 'Container not found', step: 'pull' };
    }

    // Re-check right before acting: the cached digests may be hours old, and pulling a stale
    // `repo@digest` and retagging would move the tag backwards.
    const registryCreds = this.deps.getRegistryAuth ? await this.deps.getRegistryAuth() : undefined;
    const fresh = await this.checkContainer(
      {
        id: before.id,
        name: before.name,
        image: isImageIdRef(before.image) ? cachedRow.image : before.image,
        imageId: before.imageId,
      },
      registryCreds,
    ).catch(() => null);
    const cached = fresh ?? mapRow(cachedRow);
    if (!cached.updateAvailable || !cached.remoteDigest) {
      return { ok: false, message: 'No update available' };
    }
    const failedDigest = rolledBackDigests.get(before.name);
    if (opts?.auto && failedDigest && failedDigest === cached.remoteDigest) {
      return {
        ok: false,
        step: 'rollback',
        message: `Skipped: ${cached.remoteDigest.slice(0, 19)} was rolled back earlier`,
      };
    }

    const previousImage = cached.image;
    const previousImageId = before.imageId ?? null;
    const previousDigest = cached.currentDigest;
    const remoteDigest = cached.remoteDigest;
    const containerName = before.name;
    const composeServiceName =
      before.composeService ?? before.labels['com.docker.compose.service'] ?? null;
    let composeProjectId: string | null = null;

    if (before.composeProject) {
      // Match on the working dir label: compose normalises project names (and `name:` /
      // COMPOSE_PROJECT_NAME override them), so the folder name is not a reliable key.
      const workingDir = before.labels['com.docker.compose.project.working_dir'];
      composeProjectId = this.deps.compose
        ? workingDir
          ? await this.deps.compose.findId(workingDir, before.composeProject)
          : ((await this.deps.compose.list()).find((p) => p.name === before.composeProject)?.id ??
            null)
        : null;
      if (!composeProjectId) {
        return {
          ok: false,
          step: 'pull',
          message: `Compose project "${before.composeProject}" (${workingDir ?? 'unknown dir'}) is not in Dockora's compose search paths – refusing to recreate it as a standalone container`,
        };
      }
    }

    // Pull exact digest, but recreate with the original tag (e.g. :latest) so Config.Image
    // stays human-readable and matches the compose YAML.
    const taggedRef = previousImage;
    const digestRef = taggedRef.includes('@') ? null : `${stripTag(taggedRef)}@${remoteDigest}`;
    const runRef = taggedRef;
    const pullAuth = await this.resolvePullAuth(taggedRef, registryCreds);

    try {
      let pulledDigest = false;
      if (digestRef) {
        pulledDigest = await this.deps.docker
          .pullImage(digestRef, pullAuth)
          .then(() => true)
          .catch(() => false);
      }
      if (pulledDigest && digestRef) {
        await this.deps.docker.tagImage(digestRef, runRef);
      } else {
        // Digest pull unsupported (some registries/mirrors) – pulling the tag moves it itself.
        await this.deps.docker.pullImage(taggedRef, pullAuth);
      }
    } catch (error) {
      return {
        ok: false,
        step: 'pull',
        message: `Pull failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }

    const rollbackInput = {
      previousImage,
      previousImageId,
      previousDigest,
      composeProjectId,
      composeServiceName,
      containerName,
      containerId,
      pullAuth,
    };

    let recreateMsg = '';
    try {
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
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const rolled = await this.rollbackUpdate(rollbackInput);
      return {
        ok: false,
        rolledBack: true,
        step: 'rollback',
        message: `Recreate failed: ${message}. ${rolled}`,
      };
    }

    const health = await waitForContainerHealthy(this.deps.docker, containerName);
    if (!health.ok) {
      rolledBackDigests.set(containerName, remoteDigest);
      const rolled = await this.rollbackUpdate(rollbackInput);
      return {
        ok: false,
        rolledBack: true,
        step: 'rollback',
        message: `Update failed healthcheck: ${health.message}. ${rolled}`,
      };
    }
    rolledBackDigests.delete(containerName);

    // Cache aktualisieren
    let newImageId: string | undefined;
    try {
      const list = await this.deps.docker.listContainers(true);
      const current =
        list.find((c) => c.name.replace(/^\//, '') === containerName.replace(/^\//, '')) ??
        list.find((c) => c.id === containerId);
      if (current) {
        newImageId = current.imageId;
        await this.checkContainer(current, registryCreds);
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

    // Only drop the image this update replaced – a global prune would also delete unrelated
    // dangling images. Docker refuses while another container still uses it; that's fine.
    let prunedImages = 0;
    if (previousImageId && previousImageId !== newImageId) {
      try {
        await this.deps.docker.removeImage(previousImageId);
        prunedImages = 1;
      } catch {
        // still in use or already gone
      }
    }
    const pruneMsg = prunedImages > 0 ? ' Previous image removed.' : '';

    return {
      ok: true,
      step: 'done',
      prunedImages,
      message: `Image pulled.${recreateMsg} ${health.message}${pruneMsg}`,
    };
  }

  private async resolvePullAuth(
    imageRef: string,
    creds?: { ghcrToken: string; lscrToken: string },
  ): Promise<RegistryPullAuth | undefined> {
    const host = parseImageRef(imageRef).registryHost;
    const auth = await this.resolveAuth(host, creds).catch(() => undefined);
    if (!auth) return undefined;
    return { username: auth.username, password: auth.token, serveraddress: host };
  }

  private async rollbackUpdate(input: {
    previousImage: string;
    previousImageId: string | null;
    previousDigest: string | null;
    composeProjectId: string | null;
    composeServiceName: string | null;
    containerName: string;
    containerId: string;
    pullAuth?: RegistryPullAuth;
  }): Promise<string> {
    try {
      // Point the tag back at the old image (still local), so the container keeps a readable
      // `repo:tag` reference and the next check compares against the right tag.
      let restored = false;
      if (input.previousImageId && !input.previousImage.includes('@')) {
        restored = await this.deps.docker
          .tagImage(input.previousImageId, input.previousImage)
          .then(() => true)
          .catch(() => false);
      }
      if (!restored && input.previousDigest && !input.previousImage.includes('@')) {
        const digestRef = `${stripTag(input.previousImage)}@${input.previousDigest}`;
        await this.deps.docker.pullImage(digestRef, input.pullAuth);
        await this.deps.docker.tagImage(digestRef, input.previousImage);
        restored = true;
      }
      if (!restored) {
        return 'Rollback skipped: previous image is no longer available locally.';
      }
      const imageRef = input.previousImage;

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
        if (!current) {
          return `Rollback failed: container ${input.containerName} no longer exists.`;
        }
        await recreateStandaloneContainer(this.deps.docker, current.id, imageRef);
      }
      return `Rolled back to the previous image (${imageRef}).`;
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
    const byId = isImageIdRef(image);
    const parsed = byId ? null : parseImageRef(image);
    const registry = parsed?.registry ?? 'private';
    const currentTag = parsed?.tag ?? '';
    const row = await prisma.updateCheckCache.upsert({
      where: { containerId },
      create: {
        containerId,
        containerName,
        image,
        currentDigest: null,
        remoteDigest: null,
        updateAvailable: false,
        registry,
        currentTag,
        error: message,
        checkedAt: new Date(),
      },
      update: {
        containerName,
        image,
        registry,
        currentTag,
        ...(byId ? { currentDigest: null, remoteDigest: null, updateAvailable: false } : {}),
        error: message,
        checkedAt: new Date(),
      },
    });
    return mapRow(row);
  }
}

function remoteCacheKey(image: string): string {
  const parsed = parseImageRef(image);
  return `${parsed.registryHost}/${apiRepositoryPath(parsed)}:${parsed.tag}`;
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
      return fetchOciDigest(parsed.registryHost, parsed, auth);
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

  // HEAD is enough for the digest header and – unlike GET – does not count against the
  // Docker Hub pull rate limit.
  let method: 'HEAD' | 'GET' = 'HEAD';
  const attempt = async (bearer?: string) => {
    const headers: Record<string, string> = { Accept: MANIFEST_ACCEPT };
    if (bearer) headers.Authorization = `Bearer ${bearer}`;
    const res = await request(url, { method, headers, signal: AbortSignal.timeout(10_000) });
    if (method === 'HEAD' && (res.statusCode === 405 || res.statusCode === 501)) {
      await res.body.dump().catch(() => undefined);
      method = 'GET';
      return request(url, { method, headers, signal: AbortSignal.timeout(10_000) });
    }
    return res;
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

  // One pause, then a single retry. A burst of retries keeps the same repo in the 429 window.
  if (res.statusCode === 429) {
    const waitMs = retryAfterMs(res.headers['retry-after']) ?? 12_000;
    await res.body.dump().catch(() => undefined);
    await sleep(waitMs);
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
  if (typeof digestHeader === 'string' && digestHeader.startsWith('sha256:')) {
    await res.body.dump().catch(() => undefined);
    return digestHeader;
  }
  await res.body.dump().catch(() => undefined);

  // No digest header: the manifest digest is the sha256 of the raw manifest body
  // (config/child digests would never match the local RepoDigests).
  method = 'GET';
  const full = await attempt(bearer);
  if (full.statusCode >= 400) {
    await full.body.dump().catch(() => undefined);
    throw new Error(`Manifest fetch failed (${full.statusCode}) for ${ref}`);
  }
  const fullHeader = full.headers['docker-content-digest'];
  const raw = Buffer.from(await full.body.arrayBuffer());
  if (typeof fullHeader === 'string' && fullHeader.startsWith('sha256:')) return fullHeader;
  return `sha256:${createHash('sha256').update(raw).digest('hex')}`;
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

function retryAfterMs(header: string | string[] | undefined): number | null {
  const raw = Array.isArray(header) ? header[0] : header;
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.min(Math.max(seconds, 1), 30) * 1000;
  const at = Date.parse(raw);
  if (Number.isFinite(at)) return Math.min(Math.max(at - Date.now(), 1_000), 30_000);
  return null;
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

  const old = docker.getContainer(containerId);
  const info = await old.inspect();
  const name = info.Name?.replace(/^\//, '') || undefined;
  const image = imageOverride || info.Config?.Image;
  if (!image) throw new Error('Container has no image reference');

  // Cmd/Entrypoint in Config include the *old* image defaults. Only carry them over when the
  // user overrode them, otherwise a new image with changed defaults would run stale commands.
  const oldImageConfig = await docker
    .getImage(info.Image)
    .inspect()
    .then((i) => i.Config)
    .catch(() => undefined);
  const sameArray = (a?: string[] | null, b?: string[] | null) =>
    JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  const cmd = oldImageConfig && sameArray(info.Config?.Cmd, oldImageConfig.Cmd) ? undefined : info.Config?.Cmd;
  const entrypoint =
    oldImageConfig && sameArray(info.Config?.Entrypoint as string[] | undefined, oldImageConfig.Entrypoint as string[] | undefined)
      ? undefined
      : info.Config?.Entrypoint;

  // Keep anonymous volumes: they are not in Binds, so re-attach them by name.
  const hostConfig = { ...(info.HostConfig ?? {}) } as Docker.HostConfig;
  const declared = new Set(
    [
      ...(hostConfig.Binds ?? []).map((b) => b.split(':')[1]),
      ...((hostConfig.Mounts ?? []) as Array<{ Target?: string }>).map((m) => m.Target),
    ].filter(Boolean),
  );
  const extraBinds = (info.Mounts ?? [])
    .filter((m) => m.Type === 'volume' && m.Name && !declared.has(m.Destination))
    .map((m) => `${m.Name}:${m.Destination}${m.RW === false ? ':ro' : ''}`);
  if (extraBinds.length) hostConfig.Binds = [...(hostConfig.Binds ?? []), ...extraBinds];

  // Networks: create with the primary one (older APIs accept only one), connect the rest after.
  const networks = Object.entries(info.NetworkSettings?.Networks ?? {});
  const endpoint = (cfg: Docker.NetworkInfo) => ({
    Aliases: (cfg.Aliases ?? []).filter((a: string) => !info.Id.startsWith(a)),
    IPAMConfig: cfg.IPAMConfig ?? undefined,
    Links: cfg.Links ?? undefined,
  });
  const primary = networks.find(([net]) => net === hostConfig.NetworkMode) ?? networks[0];
  const usesOwnNetworkStack = /^(host|none|container:)/.test(hostConfig.NetworkMode ?? '');

  const createOpts: Docker.ContainerCreateOptions = {
    ...(info.Config as Docker.ContainerCreateOptions),
    name,
    Image: image,
    Cmd: cmd ?? undefined,
    Entrypoint: entrypoint ?? undefined,
    // Hostname defaults to the container ID; keep it only if it was set explicitly.
    Hostname: info.Config?.Hostname && !info.Id.startsWith(info.Config.Hostname) ? info.Config.Hostname : undefined,
    HostConfig: hostConfig,
    NetworkingConfig:
      primary && !usesOwnNetworkStack
        ? { EndpointsConfig: { [primary[0]]: endpoint(primary[1]) } }
        : undefined,
  };

  // Keep the old container (renamed, stopped) until the new one runs, so a failed create/start
  // can be undone instead of leaving the user without a container.
  const backupName = name ? `${name}-dockora-old-${Date.now().toString(36)}` : undefined;
  try {
    await old.stop({ t: 10 });
  } catch {
    // already stopped
  }
  if (backupName) await old.rename({ name: backupName });
  // Brief settle so docker-proxy can release host ports
  await sleep(500);

  let created: Docker.Container | null = null;
  try {
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await sleep(1_000 * attempt);
      try {
        if (created) {
          await created.remove({ force: true }).catch(() => undefined);
          created = null;
        }
        created = await docker.createContainer(createOpts);
        if (!usesOwnNetworkStack) {
          for (const [net, cfg] of networks) {
            if (net === primary?.[0]) continue;
            await docker.getNetwork(net).connect({ Container: created.id, EndpointConfig: endpoint(cfg) });
          }
        }
        await created.start();
        lastError = undefined;
        break;
      } catch (error) {
        lastError = error;
        const msg = error instanceof Error ? error.message : String(error);
        if (!/port is already allocated|address already in use/i.test(msg)) break;
      }
    }
    if (lastError) throw lastError;
  } catch (error) {
    if (created) await created.remove({ force: true }).catch(() => undefined);
    if (backupName && name) await old.rename({ name }).catch(() => undefined);
    if (info.State?.Running) await old.start().catch(() => undefined);
    throw error instanceof Error ? error : new Error(String(error));
  }

  await old.remove({ force: true }).catch(() => undefined);
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
