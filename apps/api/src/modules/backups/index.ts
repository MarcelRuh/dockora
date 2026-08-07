import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { API_PREFIX, type BackupFormat, type BackupInfo } from '@dockora/shared';
import {
  PrismaSettingsRepository,
  SettingsService,
} from '../settings/settings.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { actorIdFromRequest, auditService } from '../audit/audit.service.js';
import { destructiveRateLimit } from '../../presentation/http/destructive-rate-limit.js';
import { BackupsService } from './backups.service.js';

export const backupsModule: FastifyPluginAsync = async (app: FastifyInstance) => {
  const settings = new SettingsService(new PrismaSettingsRepository());
  const notifications = new NotificationsService({ settings });
  const service = new BackupsService({
    settings,
    backupDir: app.config.backupDir,
    docker: app.docker,
  });

  app.decorate('backupsService', service);

  app.get(`${API_PREFIX}/backups`, async (): Promise<BackupInfo[]> => {
    return service.list();
  });

  app.post<{
    Body: { format?: BackupFormat; includeVolumes?: boolean };
  }>(`${API_PREFIX}/backups`, { ...destructiveRateLimit }, async (request): Promise<BackupInfo> => {
    try {
      const backup = await service.create(request.body ?? {});
      await notifications.notify(
        'backup.completed',
        'Backup erstellt',
        `Backup ${backup.name} (${backup.sizeBytes} bytes)`,
        'success',
      );
      void auditService.record({
        action: 'backup.create',
        actorId: actorIdFromRequest(request),
        resource: 'backup',
        resourceId: backup.id,
        metadata: { name: backup.name, includeVolumes: request.body?.includeVolumes === true },
      });
      return backup;
    } catch (error) {
      throw app.httpErrors.badRequest(error instanceof Error ? error.message : String(error));
    }
  });

  app.post(`${API_PREFIX}/backups/cleanup`, { ...destructiveRateLimit }, async () => {
    return service.cleanup();
  });

  app.delete<{ Params: { id: string } }>(
    `${API_PREFIX}/backups/:id`,
    { ...destructiveRateLimit, preHandler: [app.requireRole('admin')] },
    async (request, reply) => {
      await service.delete(request.params.id);
      void auditService.record({
        action: 'backup.delete',
        actorId: actorIdFromRequest(request),
        resource: 'backup',
        resourceId: request.params.id,
      });
      return reply.status(204).send();
    },
  );

  app.post<{
    Params: { id: string };
    Body: {
      confirm?: boolean;
      applyFiles?: boolean;
      applySettings?: boolean;
      applyVolumes?: boolean;
    };
  }>(
    `${API_PREFIX}/backups/:id/restore`,
    { ...destructiveRateLimit, preHandler: [app.requireRole('admin')] },
    async (request) => {
      try {
        const result = await service.restore(request.params.id, request.body ?? {});
        if (
          result.ok &&
          request.body?.confirm &&
          (result.appliedFiles > 0 || result.appliedSettings || result.appliedVolumes > 0)
        ) {
          await notifications.notify(
            'restore.completed',
            'Restore abgeschlossen',
            result.message,
            'success',
          );
          void auditService.record({
            action: 'backup.restore',
            actorId: actorIdFromRequest(request),
            resource: 'backup',
            resourceId: request.params.id,
            metadata: {
              appliedFiles: result.appliedFiles,
              appliedSettings: result.appliedSettings,
              appliedVolumes: result.appliedVolumes,
            },
          });
        }
        return result;
      } catch (error) {
        throw app.httpErrors.badRequest(error instanceof Error ? error.message : String(error));
      }
    },
  );
};

declare module 'fastify' {
  interface FastifyInstance {
    backupsService: BackupsService;
  }
}

export { BackupsService };
