import type { UpdateCheckResult, RegistryProvider } from '@dockora/shared';
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

export interface UpdatesServiceDeps {
  docker: IDockerClient;
  compose?: ComposeService;
}

export class UpdatesService {
  constructor(private readonly deps: UpdatesServiceDeps) {}

  async listCached(): Promise<UpdateCheckResult[]> {
    const rows = await prisma.updateCheckCache.findMany({
      orderBy: { checkedAt: 'desc' },
    });
    return rows.map(mapRow);
  }

  async countAvailable(): Promise<number> {
    return prisma.updateCheckCache.count({
      where: { updateAvailable: true },
    });
  }

  async checkAll(allContainers = false): Promise<UpdateCheckResult[]> {
    const containers = (await this.deps.docker.listContainers(allContainers)).filter(
      (c) => !isDockoraSelfContainer(c),
    );
    const results: UpdateCheckResult[] = [];

    for (const container of containers) {
      try {
        const result = await this.checkContainer(container.id, container.name, container.image);
        results.push(result);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const fallback = await this.persistError(
          container.id,
          container.name,
          container.image,
          message,
        );
        results.push(fallback);
      }
    }

    return results;
  }

  async checkContainer(
    containerId: string,
    containerName: string,
    image: string,
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
      remoteDigest = await fetchRemoteDigest(parsed);
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
  async applyUpdate(containerId: string): Promise<{ ok: boolean; message: string }> {
    const cached = await prisma.updateCheckCache.findUnique({ where: { containerId } });
    if (!cached) {
      return { ok: false, message: 'No cached update info for container' };
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

      const targetRef =
        remoteDigest && !cached.image.includes('@')
          ? `${stripTag(cached.image)}@${remoteDigest}`
          : cached.image;

      await this.deps.docker.pullImage(targetRef).catch(async () => {
        await this.deps.docker.pullImage(cached.image);
      });

      let recreateMsg = '';
      if (composeProjectId && this.deps.compose && composeServiceName) {
        await this.deps.compose.recreatePinned(composeProjectId, {
          serviceName: composeServiceName,
          imageRef: targetRef,
        });
        recreateMsg = ` Compose service "${composeServiceName}" recreated (${targetRef}).`;
      } else if (composeProjectId && this.deps.compose) {
        await this.deps.compose.runAction(composeProjectId, 'recreate');
        recreateMsg = ' Compose project recreated.';
      } else {
        await recreateStandaloneContainer(this.deps.docker, containerId, targetRef);
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

      return {
        ok: true,
        message: `Image pulled.${recreateMsg} ${health.message}`,
      };
    } catch (error) {
      return {
        ok: false,
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
): Promise<string | null> {
  switch (parsed.registry) {
    case 'dockerhub':
      return fetchDockerHubDigest(parsed);
    case 'ghcr':
      return fetchOciDigest('ghcr.io', parsed);
    case 'quay':
      return fetchOciDigest('quay.io', parsed);
    case 'gitea':
    case 'gitlab':
    case 'private':
      return fetchOciDigest(parsed.registryHost, parsed);
    default:
      return fetchOciDigest(parsed.registryHost, parsed);
  }
}

async function fetchDockerHubDigest(
  parsed: ReturnType<typeof parseImageRef>,
): Promise<string | null> {
  const repoPath = apiRepositoryPath(parsed);
  const tokenUrl = `https://auth.docker.io/token?service=registry.docker.io&scope=repository:${repoPath}:pull`;
  const tokenRes = await request(tokenUrl);
  if (tokenRes.statusCode >= 400) {
    throw new Error(`Docker Hub auth failed (${tokenRes.statusCode})`);
  }
  const tokenBody = (await tokenRes.body.json()) as { token?: string; access_token?: string };
  const token = tokenBody.token ?? tokenBody.access_token;
  if (!token) {
    throw new Error('Docker Hub auth returned no token');
  }

  return fetchManifestDigest('registry-1.docker.io', repoPath, parsed.tag, token);
}

async function fetchOciDigest(
  registryHost: string,
  parsed: ReturnType<typeof parseImageRef>,
): Promise<string | null> {
  const repoPath = apiRepositoryPath(parsed);
  let token: string | undefined;

  try {
    const tokenUrl = `https://${registryHost}/token?service=${registryHost}&scope=repository:${repoPath}:pull`;
    const tokenRes = await request(tokenUrl);
    if (tokenRes.statusCode < 400) {
      const body = (await tokenRes.body.json()) as { token?: string; access_token?: string };
      token = body.token ?? body.access_token;
    }
  } catch {
    // Anonyme Registries ohne Token-Endpoint
  }

  return fetchManifestDigest(registryHost, repoPath, parsed.tag, token);
}

async function fetchManifestDigest(
  registryHost: string,
  repoPath: string,
  tag: string,
  token?: string,
): Promise<string | null> {
  const url = `https://${registryHost}/v2/${repoPath}/manifests/${tag}`;
  const headers: Record<string, string> = {
    Accept:
      'application/vnd.docker.distribution.manifest.v2+json, application/vnd.oci.image.manifest.v1+json',
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await request(url, { headers });
  if (res.statusCode === 401 && !token) {
    throw new Error(`Registry auth required (${registryHost})`);
  }
  if (res.statusCode >= 400) {
    throw new Error(`Manifest fetch failed (${res.statusCode})`);
  }

  const digestHeader = res.headers['docker-content-digest'];
  if (typeof digestHeader === 'string') {
    return digestHeader;
  }

  const body = (await res.body.json()) as {
    config?: { digest?: string };
    layers?: Array<{ digest?: string }>;
  };

  if (body.config?.digest) {
    return body.config.digest;
  }

  return null;
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

  const created = await docker.createContainer({
    name,
    Image: imageOverride || info.Config?.Image,
    Env: info.Config?.Env,
    Cmd: info.Config?.Cmd ?? undefined,
    Entrypoint: info.Config?.Entrypoint ?? undefined,
    WorkingDir: info.Config?.WorkingDir || undefined,
    Labels: info.Config?.Labels ?? undefined,
    ExposedPorts: info.Config?.ExposedPorts ?? undefined,
    HostConfig: info.HostConfig ?? undefined,
  });

  await created.start();
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
