import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { API_PREFIX, type UpdateCheckResult } from '@dockora/shared';
import { ComposeService } from '../compose/compose.service.js';
import {
  PrismaSettingsRepository,
  SettingsService,
} from '../settings/settings.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { UpdatesService } from './updates.service.js';
import { notifyUpdatesAvailable, notifyUpdatesInstalled } from './notify-updates.js';

export const updatesModule: FastifyPluginAsync = async (app: FastifyInstance) => {
  const compose = new ComposeService({
    docker: app.docker,
    searchPaths: app.config.composeSearchPaths,
    excludePaths: app.config.composeExcludePaths,
  });
  const settings = new SettingsService(new PrismaSettingsRepository());
  const notifications = new NotificationsService({ settings });
  const service = new UpdatesService({
    docker: app.docker,
    compose,
    getRegistryAuth: async () => {
      const s = await settings.getSettings();
      return { ghcrToken: s.ghcrToken, lscrToken: s.lscrToken };
    },
  });

  app.decorate('updatesService', service);

  app.get(`${API_PREFIX}/updates`, async (): Promise<UpdateCheckResult[]> => {
    return service.listCached();
  });

  app.get(`${API_PREFIX}/updates/count`, async (): Promise<{ count: number }> => {
    const count = await service.countAvailable();
    return { count };
  });

  app.post(`${API_PREFIX}/updates/check`, async (): Promise<UpdateCheckResult[]> => {
    const results = await service.checkAll(true);
    // Same Discord/in-app signal as the scheduled update_check job
    await notifyUpdatesAvailable(notifications, results);
    return results;
  });

  app.post<{ Params: { containerId: string } }>(
    `${API_PREFIX}/updates/:containerId/pull`,
    { preHandler: [app.requireRole('admin', 'operator')] },
    async (request) => {
      const before = (await service.listCached()).find(
        (r) => r.containerId === request.params.containerId,
      );
      const result = await service.applyUpdate(request.params.containerId);
      if (result.ok && before) {
        await notifyUpdatesInstalled(notifications, [before]);
      }
      return result;
    },
  );
};

declare module 'fastify' {
  interface FastifyInstance {
    updatesService: UpdatesService;
  }
}

export { UpdatesService };
