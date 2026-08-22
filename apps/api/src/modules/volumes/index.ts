import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { API_PREFIX, type VolumeBrowseEntry, type VolumeSummary } from '@dockora/shared';
import { throwDockerError, withDockerError } from '../../domain/docker-errors.js';
import { destructiveRateLimit } from '../../presentation/http/destructive-rate-limit.js';
import { VolumeGuardError, VolumesService } from './volumes.service.js';

/**
 * Volumes-Modul – Liste, Größe, Prune ungenutzter Volumes, optionales Browse.
 */
export const volumesModule: FastifyPluginAsync = async (app: FastifyInstance) => {
  const service = new VolumesService(app.docker);

  app.get(`${API_PREFIX}/volumes`, async (): Promise<VolumeSummary[]> => {
    return withDockerError(app, () => service.list());
  });

  app.get<{ Params: { name: string } }>(
    `${API_PREFIX}/volumes/:name/browse`,
    async (request): Promise<VolumeBrowseEntry[]> => {
      try {
        return await service.browse(request.params.name);
      } catch (error) {
        if (error instanceof Error && error.message === 'Invalid volume name') {
          throw app.httpErrors.badRequest(error.message);
        }
        return await throwDockerError(app, error);
      }
    },
  );

  app.post(
    `${API_PREFIX}/volumes/prune`,
    { ...destructiveRateLimit, preHandler: [app.requireRole('admin')] },
    async () => {
      return withDockerError(app, () => service.prune());
    },
  );

  app.delete<{ Params: { name: string } }>(
    `${API_PREFIX}/volumes/:name`,
    { ...destructiveRateLimit, preHandler: [app.requireRole('admin')] },
    async (request) => {
      try {
        return await service.remove(request.params.name);
      } catch (error) {
        if (error instanceof VolumeGuardError) {
          throw app.httpErrors.conflict(error.message);
        }
        return await throwDockerError(app, error);
      }
    },
  );
};
