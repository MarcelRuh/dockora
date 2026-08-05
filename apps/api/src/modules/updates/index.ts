import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { API_PREFIX, type UpdateCheckResult } from '@dockora/shared';
import { ComposeService } from '../compose/compose.service.js';
import { UpdatesService } from './updates.service.js';

export const updatesModule: FastifyPluginAsync = async (app: FastifyInstance) => {
  const compose = new ComposeService({
    docker: app.docker,
    searchPaths: app.config.composeSearchPaths,
    excludePaths: app.config.composeExcludePaths,
  });
  const service = new UpdatesService({ docker: app.docker, compose });

  app.decorate('updatesService', service);

  app.get(`${API_PREFIX}/updates`, async (): Promise<UpdateCheckResult[]> => {
    return service.listCached();
  });

  app.get(`${API_PREFIX}/updates/count`, async (): Promise<{ count: number }> => {
    const count = await service.countAvailable();
    return { count };
  });

  app.post(`${API_PREFIX}/updates/check`, async (): Promise<UpdateCheckResult[]> => {
    return service.checkAll(true);
  });

  app.post<{ Params: { containerId: string } }>(
    `${API_PREFIX}/updates/:containerId/pull`,
    { preHandler: [app.requireRole('admin', 'operator')] },
    async (request) => {
      return service.applyUpdate(request.params.containerId);
    },
  );
};

declare module 'fastify' {
  interface FastifyInstance {
    updatesService: UpdatesService;
  }
}

export { UpdatesService };
