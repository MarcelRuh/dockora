import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { API_PREFIX, type ScheduledJob } from '@dockora/shared';
import {
  PrismaSettingsRepository,
  SettingsService,
} from '../settings/settings.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { UpdatesService } from '../updates/updates.service.js';
import { BackupsService } from '../backups/backups.service.js';
import { MonitoringService } from '../monitoring/monitoring.service.js';
import { ComposeService } from '../compose/compose.service.js';
import { filterAlertsWithCooldown } from '../monitoring/alert-cooldown.js';
import { SchedulerService } from './scheduler.service.js';

export const schedulerModule: FastifyPluginAsync = async (app: FastifyInstance) => {
  const settings = new SettingsService(new PrismaSettingsRepository());
  const notifications = new NotificationsService({ settings });
  const compose = new ComposeService({
    docker: app.docker,
    searchPaths: app.config.composeSearchPaths,
    excludePaths: app.config.composeExcludePaths,
  });
  const updates = new UpdatesService({ docker: app.docker, compose });
  const backups = new BackupsService({
    settings,
    backupDir: app.config.backupDir,
    docker: app.docker,
  });
  const monitoring = new MonitoringService({
    docker: app.docker,
    hostMetrics: app.hostMetrics,
    settings,
  });

  const scheduler = new SchedulerService();

  scheduler.registerCallback('update_check', async () => {
    const results = await updates.checkAll(true);
    const available = results.filter((r) => r.updateAvailable);
    if (available.length === 0) return;

    const current = await settings.getSettings();
    const autoUpdate = current.autoUpdateImages || app.config.autoUpdateEnabled;

    if (autoUpdate) {
      let installed = 0;
      for (const item of available) {
        const result = await updates.applyUpdate(item.containerId);
        if (result.ok) installed += 1;
      }
      if (installed > 0) {
        await notifications.notify(
          'update.installed',
          'Auto-Update',
          `${installed} Container aktualisiert (Pull + Recreate).`,
          'success',
        );
      }
      return;
    }

    await notifications.notify(
      'update.available',
      'Updates verfügbar',
      `${available.length} Container haben Updates.`,
      'info',
    );
  });

  scheduler.registerCallback('backup', async () => {
    const backup = await backups.create();
    await notifications.notify(
      'backup.completed',
      'Backup erstellt',
      `Backup ${backup.name} (${backup.sizeBytes} bytes)`,
      'success',
    );
  });

  scheduler.registerCallback('cleanup', async () => {
    const { deleted } = await backups.cleanup();
    if (deleted > 0) {
      await notifications.notify(
        'backup.completed',
        'Backup-Bereinigung',
        `${deleted} alte Backups gelöscht.`,
        'info',
      );
    }
  });

  scheduler.registerCallback('healthcheck', async () => {
    const snapshot = await monitoring.getSnapshot();
    const fresh = filterAlertsWithCooldown(snapshot.alerts);
    if (fresh.length > 0) {
      await notifications.notify(
        'error',
        'Monitoring-Alerts',
        fresh.join('; '),
        'warning',
      );
    }
  });

  app.decorate('schedulerService', scheduler);

  app.addHook('onReady', async () => {
    await scheduler.start();
    app.log.info('Scheduler started');
  });

  app.addHook('onClose', async () => {
    scheduler.stop();
  });

  app.get(`${API_PREFIX}/scheduler/jobs`, async (): Promise<ScheduledJob[]> => {
    return scheduler.listJobs();
  });

  app.patch<{
    Params: { id: string };
    Body: { enabled?: boolean; cron?: string };
  }>(
    `${API_PREFIX}/scheduler/jobs/:id`,
    { preHandler: [app.requireRole('admin')] },
    async (request): Promise<ScheduledJob> => {
      return scheduler.updateJob(request.params.id, request.body ?? {});
    },
  );

  app.post<{ Params: { id: string } }>(
    `${API_PREFIX}/scheduler/jobs/:id/run`,
    { preHandler: [app.requireRole('admin', 'operator')] },
    async (request) => {
      return scheduler.runJob(request.params.id);
    },
  );
};

declare module 'fastify' {
  interface FastifyInstance {
    schedulerService: SchedulerService;
  }
}

export { SchedulerService };
