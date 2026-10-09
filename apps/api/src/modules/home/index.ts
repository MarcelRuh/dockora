import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { API_PREFIX, type HomeLayout, type HomeLayoutResponse } from '@dockora/shared';
import { actorIdFromRequest, auditService } from '../audit/audit.service.js';
import { isAuthEnabled } from '../auth/auth-gate.js';
import { OPERATOR_ROLES } from '../auth/role-policy.js';
import { ComposeService } from '../compose/compose.service.js';
import { PrismaSettingsRepository } from '../settings/settings.service.js';
import { discoverProjectPublicUrls, sanitizePublicUrl } from './discover-urls.js';
import { prisma } from '../../infrastructure/db/prisma.js';
import {
  HOME_LAYOUT_KEY,
  HOME_LAYOUT_REVISION_KEY,
  expectedHomeRevision,
  normalizeHomeLayout,
  readHomeLayoutState,
} from './layout.js';

const MAX_BODY_CHARS = 64_000;

export const homeModule: FastifyPluginAsync = async (app: FastifyInstance) => {
  const repo = new PrismaSettingsRepository();
  const compose = new ComposeService({
    docker: app.docker,
    searchPaths: app.config.composeSearchPaths,
    excludePaths: app.config.composeExcludePaths,
  });

  app.get(`${API_PREFIX}/home/layout`, async (request): Promise<HomeLayoutResponse> => {
    const state = await readLayout(repo);
    const authOn = await isAuthEnabled();
    const role = request.user?.role;
    if (authOn && role !== 'admin' && role !== 'operator') {
      return { ...state, layout: redactHomeUrls(state.layout) };
    }
    return state;
  });

  app.get(
    `${API_PREFIX}/home/discovered-urls`,
    { preHandler: [app.requireRole(...OPERATOR_ROLES)] },
    async (): Promise<{ urls: Record<string, string> }> => {
      return { urls: await discoverContainerPublicUrls(compose, app.docker) };
    },
  );

  app.put<{ Body: unknown }>(
    `${API_PREFIX}/home/layout`,
    { preHandler: [app.requireRole(...OPERATOR_ROLES)] },
    async (request): Promise<HomeLayoutResponse> => {
      const encoded = JSON.stringify(request.body ?? null);
      if (encoded.length > MAX_BODY_CHARS) {
        throw app.httpErrors.payloadTooLarge('Home layout is too large');
      }
      const expected = expectedHomeRevision(request.body);
      const layout = normalizeHomeLayout(request.body);
      try {
        const saved = await writeHomeLayout(expected, layout);
        void auditService.record({
          action: 'home.layout.update',
          actorId: actorIdFromRequest(request),
          resource: 'home',
          metadata: {
            links: layout.links.length,
            urls: Object.keys(layout.appUrls).length,
            revision: saved.revision,
          },
        });
        return saved;
      } catch (error) {
        if (error instanceof HomeLayoutConflict) throw app.httpErrors.conflict(error.message);
        throw error;
      }
    },
  );
};

function redactHomeUrls(layout: HomeLayout): HomeLayout {
  const cleanMap = (urls: Record<string, string>) =>
    Object.fromEntries(Object.entries(urls).map(([key, value]) => [key, sanitizePublicUrl(value)]));
  return {
    ...layout,
    appUrls: cleanMap(layout.appUrls ?? {}),
    appPublicUrls: cleanMap(layout.appPublicUrls ?? {}),
    links: (layout.links ?? []).map((link) => ({ ...link, url: sanitizePublicUrl(link.url) })),
  };
}

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
        urls[container.name] = sanitizePublicUrl(byService[service]!);
      }
    } catch {
      // One unreadable stack should not hide the others.
    }
  }
  return urls;
}

class HomeLayoutConflict extends Error {
  constructor() {
    super('Home layout changed');
    this.name = 'HomeLayoutConflict';
  }
}

async function writeHomeLayout(
  expected: number | null,
  layout: HomeLayout,
): Promise<HomeLayoutResponse> {
  const value = JSON.stringify(layout);
  return prisma.$transaction(async (tx) => {
    const [layoutRow, revisionRow] = await Promise.all([
      tx.setting.findUnique({ where: { key: HOME_LAYOUT_KEY } }),
      tx.setting.findUnique({ where: { key: HOME_LAYOUT_REVISION_KEY } }),
    ]);
    const current = readHomeLayoutState(layoutRow?.value ?? null, revisionRow?.value ?? null);
    if (expected !== null && expected !== current.revision) throw new HomeLayoutConflict();
    const revision = current.revision + 1;
    await tx.setting.upsert({
      where: { key: HOME_LAYOUT_KEY },
      create: { key: HOME_LAYOUT_KEY, value },
      update: { value },
    });
    await tx.setting.upsert({
      where: { key: HOME_LAYOUT_REVISION_KEY },
      create: { key: HOME_LAYOUT_REVISION_KEY, value: String(revision) },
      update: { value: String(revision) },
    });
    return { stored: true, revision, layout };
  });
}

async function readLayout(repo: PrismaSettingsRepository): Promise<HomeLayoutResponse> {
  const [raw, revision] = await Promise.all([
    repo.get(HOME_LAYOUT_KEY),
    repo.get(HOME_LAYOUT_REVISION_KEY),
  ]);
  return readHomeLayoutState(raw, revision);
}
