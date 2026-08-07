import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { API_PREFIX, type AppSettings } from '@dockora/shared';
import { invalidateAuthEnabledCache } from '../auth/auth-gate.js';
import { actorIdFromRequest, auditService } from '../audit/audit.service.js';
import {
  PrismaSettingsRepository,
  SettingsService,
} from './settings.service.js';
import {
  maskSecret,
  maskWebhookUrl,
  shouldKeepSecret,
  shouldKeepWebhook,
} from './secret-hygiene.js';

const SECRET_KEYS = ['discordWebhookUrl', 'ghcrToken', 'lscrToken'] as const;

function maskSettingsSecrets(settings: AppSettings): AppSettings {
  return {
    ...settings,
    discordWebhookUrl: maskWebhookUrl(settings.discordWebhookUrl),
    ghcrToken: maskSecret(settings.ghcrToken),
    lscrToken: maskSecret(settings.lscrToken),
  };
}

export const settingsModule: FastifyPluginAsync = async (app: FastifyInstance) => {
  const service = new SettingsService(new PrismaSettingsRepository());

  app.get(`${API_PREFIX}/settings`, async (): Promise<AppSettings> => {
    const settings = await service.getSettings({
      dockerSocket: app.config.dockerSocket,
      composeSearchPaths: app.config.composeSearchPaths,
      autoUpdateImages: app.config.autoUpdateEnabled,
    });
    return maskSettingsSecrets(settings);
  });

  app.put<{ Body: Partial<AppSettings> }>(
    `${API_PREFIX}/settings`,
    { preHandler: [app.requireRole('admin')] },
    async (request): Promise<AppSettings> => {
      const patch = { ...(request.body ?? {}) };
      if (shouldKeepWebhook(patch.discordWebhookUrl)) {
        delete patch.discordWebhookUrl;
      }
      if (shouldKeepSecret(patch.ghcrToken)) {
        delete patch.ghcrToken;
      }
      if (shouldKeepSecret(patch.lscrToken)) {
        delete patch.lscrToken;
      }
      const updated = await service.updateSettings(patch);
      if ('authEnabled' in patch) {
        invalidateAuthEnabledCache();
      }
      const keys = Object.keys(patch).filter(
        (k) => !(SECRET_KEYS as readonly string[]).includes(k),
      );
      void auditService.record({
        action: 'settings.update',
        actorId: actorIdFromRequest(request),
        resource: 'settings',
        metadata: {
          keys,
          webhookUpdated:
            'discordWebhookUrl' in (request.body ?? {}) &&
            !shouldKeepWebhook(request.body?.discordWebhookUrl),
          registryTokensUpdated:
            ('ghcrToken' in (request.body ?? {}) && !shouldKeepSecret(request.body?.ghcrToken)) ||
            ('lscrToken' in (request.body ?? {}) && !shouldKeepSecret(request.body?.lscrToken)),
        },
      });
      return maskSettingsSecrets(updated);
    },
  );
};

export { SettingsService, PrismaSettingsRepository };
