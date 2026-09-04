import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { API_PREFIX, type ScheduledJob } from '@dockora/shared';
import {
  PrismaSettingsRepository,
  SettingsService,
} from '../settings/settings.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { UpdatesService } from '../updates/updates.service.js';
import {
  notifyUpdatesAvailable,
  notifyUpdatesInstalled,
} from '../updates/notify-updates.js';
import { BackupsService } from '../backups/backups.service.js';
import { MonitoringService } from '../monitoring/monitoring.service.js';
import { ComposeService } from '../compose/compose.service.js';
import { filterAlertsWithCooldown } from '../monitoring/alert-cooldown.js';
import { SchedulerService } from './scheduler.service.js';
import { lifetimeStatsService } from '../dashboard/lifetime.service.js';
import { pruneDataRetention } from '../settings/data-retention.js';

export const schedulerModule: FastifyPluginAsync = async (app: FastifyInstance) => {
  const settings = new SettingsService(new PrismaSettingsRepository());
  const notifications = new NotificationsService({ settings });
  const compose = new ComposeService({
    docker: app.docker,
    searchPaths: app.config.composeSearchPaths,
    excludePaths: app.config.composeExcludePaths,
  });
  const updates = new UpdatesService({
    docker: app.docker,
    compose,
    getRegistryAuth: async () => {
      const s = await settings.getSettings();
      return { ghcrToken: s.ghcrToken, lscrToken: s.lscrToken };
    },
  });
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
    const available = results.filter((r) => r.updateAvailable && !r.error);
    if (available.length === 0) return;

    const current = await settings.getSettings();
    const autoUpdate = current.autoUpdateImages || app.config.autoUpdateEnabled;

    if (autoUpdate) {
      const installed: typeof available = [];
      for (const item of available) {
        const result = await updates.applyUpdate(item.containerId);
        if (result.ok) installed.push(item);
      }
      await notifyUpdatesInstalled(notifications, installed, { auto: true });
      return;
    }

    await notifyUpdatesAvailable(notifications, results);
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
    try {
      const current = await settings.getSettings();
      const pruned = await pruneDataRetention({
        notificationDays: current.notificationRetentionDays,
        auditDays: current.auditRetentionDays,
        force: true,
      });
      if (pruned.notificationsDeleted + pruned.auditDeleted > 0) {
        app.log.info(pruned, 'Data retention prune');
      }
    } catch (error) {
      app.log.warn(
        { err: error instanceof Error ? error.message : String(error) },
        'Data retention prune failed',
      );
    }

    const { deleted } = await backups.cleanup();
    if (deleted > 0) {
      await notifications.notify(
        'backup.completed',
        'Backup-Bereinigung',
        `${deleted} alte Backups gelöscht.`,
        'info',
      );
    }

    try {
      const before = await app.docker.getBuildCacheBytes();
      const pruned = await app.docker.pruneBuildCache();
      const after = await app.docker.getBuildCacheBytes();
      const freedMiB = Math.max(0, Math.round(pruned.spaceReclaimed / (1024 * 1024)));
      if (freedMiB > 50 || before - after > 50 * 1024 * 1024) {
        await notifications.notify(
          'system',
          'Docker-Cleanup',
          `Build-Cache bereinigt (~${freedMiB} MiB freigegeben).`,
          'info',
        );
      }
      app.log.info(
        { freedMiB, beforeBytes: before, afterBytes: after },
        'Scheduled build-cache prune',
      );
    } catch (error) {
      app.log.warn(
        { err: error instanceof Error ? error.message : String(error) },
        'Scheduled build-cache prune failed',
      );
    }
  });

  scheduler.registerCallback('healthcheck', async () => {
    const snapshot = await monitoring.getSnapshot();
    try {
      await lifetimeStatsService.recordSample({
        cpuPercent: snapshot.host.cpuPercent,
        memoryPercent: snapshot.host.memoryPercent,
        diskPercent: snapshot.host.diskPercent,
        containerCount: snapshot.containers.length,
      });
    } catch (error) {
      app.log.warn(
        { err: error instanceof Error ? error.message : String(error) },
        'Lifetime stats sample failed',
      );
    }

    // Auto-prune when build-cache alert would fire – don't wait for weekly timer
    const cacheAlert = snapshot.alerts.find((a) => /build cache/i.test(a));
    let prunedCache = false;
    if (cacheAlert) {
      try {
        const pruned = await app.docker.pruneBuildCache();
        const freedMiB = Math.round(pruned.spaceReclaimed / (1024 * 1024));
        app.log.info({ freedMiB }, 'Auto-pruned build cache after monitoring threshold');
        prunedCache = true;
        if (freedMiB > 0) {
          await notifications.notify(
            'system',
            'Build-Cache Auto-Prune',
            `${cacheAlert} → ${freedMiB} MiB freigegeben.`,
            'info',
          );
        }
      } catch (error) {
        app.log.warn(
          { err: error instanceof Error ? error.message : String(error) },
          'Auto build-cache prune failed',
        );
      }
    }

    const fresh = filterAlertsWithCooldown(
      prunedCache ? snapshot.alerts.filter((a) => !/build cache/i.test(a)) : snapshot.alerts,
    );
    if (fresh.length > 0) {
      const containerHints = fresh
        .map((a) => {
          const m = a.match(/^([^:]+):\s*(unhealthy|exited)/i);
          return m?.[1]?.trim();
        })
        .filter((n): n is string => Boolean(n));
      await notifications.notify(
        'error',
        fresh.length === 1 ? 'Monitoring-Alert' : 'Monitoring-Alerts',
        fresh.map((a) => `• ${a}`).join('\n'),
        'warning',
        { containers: containerHints },
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
