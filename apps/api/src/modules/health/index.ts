import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { API_PREFIX, type HealthResponse } from '@dockora/shared';
import { HealthService } from './health.service.js';

/**
 * Health-Modul – liveness/readiness ohne Auth.
 * status=degraded wenn Docker-Socket nicht erreichbar.
 */
export const healthModule: FastifyPluginAsync = async (app: FastifyInstance) => {
  const service = new HealthService(app.docker);

  app.get(`${API_PREFIX}/health`, async (_request, _reply): Promise<HealthResponse> => {
    return service.getHealth();
  });
};
