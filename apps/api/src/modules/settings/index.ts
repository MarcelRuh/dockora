import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { API_PREFIX, type AppSettings } from '@dockora/shared';
import { invalidateAuthEnabledCache } from '../auth/auth-gate.js';
import { actorIdFromRequest, auditService } from '../audit/audit.service.js';
import {
  PrismaSettingsRepository,
  SettingsService,
} from './settings.service.js';
import { maskWebhookUrl, shouldKeepWebhook } from './secret-hygiene.js';

export const settingsModule: FastifyPluginAsync = async (app: FastifyInstance) => {
  const service = new SettingsService(new PrismaSettingsRepository());

  app.get(`${API_PREFIX}/settings`, async (): Promise<AppSettings> => {
    const settings = await service.getSettings({
      dockerSocket: app.config.dockerSocket,
      composeSearchPaths: app.config.composeSearchPaths,
      autoUpdateImages: app.config.autoUpdateEnabled,
    });
    return {
      ...settings,
      discordWebhookUrl: maskWebhookUrl(settings.discordWebhookUrl),
    };
  });

  app.put<{ Body: Partial<AppSettings> }>(
    `${API_PREFIX}/settings`,
    { preHandler: [app.requireRole('admin')] },
    async (request): Promise<AppSettings> => {
      const patch = { ...(request.body ?? {}) };
      if (shouldKeepWebhook(patch.discordWebhookUrl)) {
        delete patch.discordWebhookUrl;
      }
      const updated = await service.updateSettings(patch);
      if ('authEnabled' in patch) {
        invalidateAuthEnabledCache();
      }
      const keys = Object.keys(patch).filter((k) => k !== 'discordWebhookUrl');
      void auditService.record({
        action: 'settings.update',
        actorId: actorIdFromRequest(request),
        resource: 'settings',
        metadata: {
          keys,
          webhookUpdated: 'discordWebhookUrl' in (request.body ?? {}) && !shouldKeepWebhook(request.body?.discordWebhookUrl),
        },
      });
      return {
        ...updated,
        discordWebhookUrl: maskWebhookUrl(updated.discordWebhookUrl),
      };
    },
  );
};

export { SettingsService, PrismaSettingsRepository };
