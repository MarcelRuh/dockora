import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { API_PREFIX, type HomeLayoutResponse } from '@dockora/shared';
import { actorIdFromRequest, auditService } from '../audit/audit.service.js';
import { OPERATOR_ROLES } from '../auth/role-policy.js';
import { PrismaSettingsRepository } from '../settings/settings.service.js';
import { HOME_LAYOUT_KEY, emptyHomeLayout, normalizeHomeLayout } from './layout.js';

const MAX_BODY_CHARS = 64_000;

export const homeModule: FastifyPluginAsync = async (app: FastifyInstance) => {
  const repo = new PrismaSettingsRepository();

  app.get(`${API_PREFIX}/home/layout`, async (): Promise<HomeLayoutResponse> => {
    return readLayout(repo);
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

async function readLayout(repo: PrismaSettingsRepository): Promise<HomeLayoutResponse> {
  const raw = await repo.get(HOME_LAYOUT_KEY);
  if (!raw) return { stored: false, layout: emptyHomeLayout() };
  try {
    return { stored: true, layout: normalizeHomeLayout(JSON.parse(raw) as unknown) };
  } catch {
    return { stored: false, layout: emptyHomeLayout() };
  }
}
