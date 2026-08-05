import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { API_PREFIX, type ActionResult, type ImageSummary } from '@dockora/shared';
import { withDockerError } from '../../domain/docker-errors.js';
import { ImagesService } from './images.service.js';

/**
 * Images-Modul – Liste, Pull, Remove und Prune.
 */
export const imagesModule: FastifyPluginAsync = async (app: FastifyInstance) => {
  const excludeTagPatterns = (app.config.imageExcludePrefixes ?? ['dockora']).map(
    (prefix) => new RegExp(`^${escapeRegex(prefix)}(-|[/:]|$)`, 'i'),
  );

  const service = new ImagesService({
    docker: app.docker,
    excludeTagPatterns,
  });

  app.get(`${API_PREFIX}/images`, async (): Promise<ImageSummary[]> => {
    return withDockerError(app, () => service.list());
  });

  app.post<{ Body: { image: string } }>(
    `${API_PREFIX}/images/pull`,
    async (request): Promise<ActionResult> => {
      if (!request.body?.image || typeof request.body.image !== 'string') {
        throw app.httpErrors.badRequest('Request body must include image: string');
      }
      return withDockerError(app, () => service.pull(request.body.image));
    },
  );

  app.post<{ Body: { danglingOnly?: boolean } }>(
    `${API_PREFIX}/images/prune`,
    async (request) => {
      const danglingOnly = request.body?.danglingOnly ?? true;
      return withDockerError(app, () => service.prune(danglingOnly));
    },
  );

  app.delete<{ Params: { id: string }; Querystring: { force?: string } }>(
    `${API_PREFIX}/images/:id`,
    { preHandler: [app.requireRole('admin')] },
    async (request): Promise<ActionResult> => {
      const force = request.query.force === 'true';
      return withDockerError(app, () => service.remove(request.params.id, force));
    },
  );
};

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
