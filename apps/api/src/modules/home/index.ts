import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { API_PREFIX, type HomeLayoutResponse } from '@dockora/shared';
import { actorIdFromRequest, auditService } from '../audit/audit.service.js';
import { OPERATOR_ROLES } from '../auth/role-policy.js';
import { ComposeService } from '../compose/compose.service.js';
import { PrismaSettingsRepository } from '../settings/settings.service.js';
import { discoverProjectPublicUrls } from './discover-urls.js';
import { HOME_LAYOUT_KEY, emptyHomeLayout, normalizeHomeLayout } from './layout.js';

const MAX_BODY_CHARS = 64_000;

export const homeModule: FastifyPluginAsync = async (app: FastifyInstance) => {
  const repo = new PrismaSettingsRepository();
  const compose = new ComposeService({
    docker: app.docker,
    searchPaths: app.config.composeSearchPaths,
    excludePaths: app.config.composeExcludePaths,
  });

  app.get(`${API_PREFIX}/home/layout`, async (): Promise<HomeLayoutResponse> => {
    return readLayout(repo);
  });

  app.get(`${API_PREFIX}/home/discovered-urls`, async (): Promise<{ urls: Record<string, string> }> => {
    return { urls: await discoverContainerPublicUrls(compose, app.docker) };
  });

  app.put<{ Body: unknown }>(
    `${API_PREFIX}/home/layout`,
    { preHandler: [app.requireRole(...OPERATOR_ROLES)] },
    async (request): Promise<HomeLayoutResponse> => {
      const encoded = JSON.stringify(request.body ?? null);
      if (encoded.length > MAX_BODY_CHARS) {
        throw app.httpErrors.payloadTooLarge('Home layout is too large');
      }
      const layout = normalizeHomeLayout(request.body);
      await repo.set(HOME_LAYOUT_KEY, JSON.stringify(layout));
      void auditService.record({
        action: 'home.layout.update',
        actorId: actorIdFromRequest(request),
        resource: 'home',
        metadata: {
          links: layout.links.length,
          urls: Object.keys(layout.appUrls).length,
        },
      });
      return { stored: true, layout };
    },
  );
};

async function discoverContainerPublicUrls(
  compose: ComposeService,
  docker: FastifyInstance['docker'],
): Promise<Record<string, string>> {
  const [projects, containers] = await Promise.all([compose.list(), docker.listContainers(true)]);
  const urls: Record<string, string> = {};
  for (const project of projects) {
    try {
      const [details, envFile] = await Promise.all([
        compose.getDetails(project.id),
        compose.getEnvFile(project.id),
      ]);
      const byService = discoverProjectPublicUrls({
        envText: envFile.content,
        services: details.services,
        yaml: details.yaml,
      });
      const projectPath = project.path.replace(/\/+$/, '');
      for (const container of containers) {
        const workingDir = container.labels['com.docker.compose.project.working_dir']?.replace(/\/+$/, '');
        const sameProject = container.composeProject === project.name || workingDir === projectPath;
        const service = container.composeService;
        if (!sameProject || !service || !byService[service]) continue;
        urls[container.name] = byService[service]!;
      }
    } catch {
      // One unreadable stack should not hide the others.
    }
  }
  return urls;
}

async function readLayout(repo: PrismaSettingsRepository): Promise<HomeLayoutResponse> {
  const raw = await repo.get(HOME_LAYOUT_KEY);
  if (!raw) return { stored: false, layout: emptyHomeLayout() };
  try {
    return { stored: true, layout: normalizeHomeLayout(JSON.parse(raw) as unknown) };
  } catch {
    return { stored: false, layout: emptyHomeLayout() };
  }
}
