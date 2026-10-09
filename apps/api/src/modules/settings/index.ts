import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { API_PREFIX, type AppSettings } from '@dockora/shared';
import { invalidateAuthEnabledCache, isAuthEnabled, isViewer } from '../auth/auth-gate.js';
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
import { cronFromUpdateIntervalMinutes } from './update-check-cron.js';

const SECRET_KEYS = ['discordWebhookUrl', 'ghcrToken', 'lscrToken', 'ntfyToken'] as const;

function maskSettingsSecrets(settings: AppSettings): AppSettings {
  return {
    ...settings,
    discordWebhookUrl: maskWebhookUrl(settings.discordWebhookUrl),
    ghcrToken: maskSecret(settings.ghcrToken),
    lscrToken: maskSecret(settings.lscrToken),
    ntfyToken: maskSecret(settings.ntfyToken),
  };
}

function hideSettingsSecrets(settings: AppSettings): AppSettings {
  return {
    ...settings,
    discordWebhookUrl: '',
    ghcrToken: '',
    lscrToken: '',
    ntfyToken: '',
  };
}

export const settingsModule: FastifyPluginAsync = async (app: FastifyInstance) => {
  const service = new SettingsService(new PrismaSettingsRepository());

  app.get(`${API_PREFIX}/settings`, async (request): Promise<AppSettings> => {
    const settings = await service.getSettings({
      dockerSocket: app.config.dockerSocket,
      composeSearchPaths: app.config.composeSearchPaths,
      autoUpdateImages: app.config.autoUpdateEnabled,
    });
    const authOn = await isAuthEnabled();
    if (authOn && request.user?.role === 'admin') {
      return maskSettingsSecrets(settings);
    }
    if (await isViewer(request)) {
      return {
        ...hideSettingsSecrets(settings),
        dockerSocket: '',
        composeSearchPaths: [],
      };
    }
    // Operators need to see that registry tokens exist without receiving the secret.
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
      if (shouldKeepSecret(patch.ntfyToken)) {
        delete patch.ntfyToken;
      }
      const updated = await service.updateSettings(patch);
      if ('authEnabled' in patch) {
        invalidateAuthEnabledCache();
      }
      if (
        typeof patch.updateCheckIntervalMinutes === 'number' &&
        app.hasDecorator('schedulerService')
      ) {
        const cron = cronFromUpdateIntervalMinutes(updated.updateCheckIntervalMinutes);
        const jobs = await app.schedulerService.listJobs();
        const job = jobs.find((entry) => entry.type === 'update_check');
        if (job && job.cron !== cron) {
          await app.schedulerService.updateJob(job.id, { cron });
        }
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
