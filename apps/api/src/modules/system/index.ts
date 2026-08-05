import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { API_PREFIX, APP_NAME, APP_VERSION } from '@dockora/shared';
import { actorIdFromRequest, auditService } from '../audit/audit.service.js';
import { SelfUpdateService } from './self-update.service.js';

/**
 * System-Meta – App-Info und Self-Update.
 */
export const systemModule: FastifyPluginAsync = async (app: FastifyInstance) => {
  const selfUpdate = new SelfUpdateService(app.docker, app.config.selfImage);

  app.get(`${API_PREFIX}/system/info`, async () => {
    return {
      name: APP_NAME,
      version: APP_VERSION,
      nodeEnv: app.config.nodeEnv,
      composeSearchPaths: app.config.composeSearchPaths,
      composeExcludePaths: app.config.composeExcludePaths,
      autoUpdateEnabled: app.config.autoUpdateEnabled,
      selfImage: app.config.selfImage,
      pluginDir: app.config.pluginDir,
    };
  });

  app.get(`${API_PREFIX}/system/self-update`, async () => {
    return selfUpdate.status();
  });

  app.post(
    `${API_PREFIX}/system/self-update`,
    { preHandler: [app.requireRole('admin')] },
    async (request) => {
      const result = await selfUpdate.apply();
      void auditService.record({
        action: 'system.self-update',
        actorId: actorIdFromRequest(request),
        resource: 'system',
        metadata: { ok: result.ok, image: app.config.selfImage },
      });
      if (!result.ok) {
        throw app.httpErrors.badRequest(result.message);
      }
      return result;
    },
  );
};
