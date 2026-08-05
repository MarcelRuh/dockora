import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { API_PREFIX, type DashboardNotification } from '@dockora/shared';
import {
  PrismaSettingsRepository,
  SettingsService,
} from '../settings/settings.service.js';
import { NotificationsService } from './notifications.service.js';

export const notificationsModule: FastifyPluginAsync = async (app: FastifyInstance) => {
  const settings = new SettingsService(new PrismaSettingsRepository());
  const service = new NotificationsService({ settings });

  app.decorate('notificationsService', service);

  app.get(`${API_PREFIX}/notifications`, async (): Promise<DashboardNotification[]> => {
    return service.list();
  });

  app.post<{ Params: { id: string } }>(
    `${API_PREFIX}/notifications/:id/read`,
    async (request, reply) => {
      await service.markRead(request.params.id);
      return reply.status(204).send();
    },
  );

  app.post(`${API_PREFIX}/notifications/read-all`, async () => {
    return service.markAllRead();
  });

  app.post(`${API_PREFIX}/notifications/test`, async () => {
    return service.testDiscord();
  });
};

declare module 'fastify' {
  interface FastifyInstance {
    notificationsService: NotificationsService;
  }
}

export { NotificationsService };
