import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import {
  API_PREFIX,
  type ActionResult,
  type ContainerAction,
  type ContainerDetails,
  type ContainerFilter,
  type ContainerStatsSnapshot,
  type ContainerSummary,
} from '@dockora/shared';
import { withDockerError } from '../../domain/docker-errors.js';
import { actorIdFromRequest, auditService } from '../audit/audit.service.js';
import { destructiveRateLimit } from '../../presentation/http/destructive-rate-limit.js';
import { ContainersService } from './containers.service.js';

const CONTAINER_ACTIONS = new Set<ContainerAction>([
  'start',
  'stop',
  'restart',
  'kill',
  'pause',
  'unpause',
  'remove',
]);

const DESTRUCTIVE_CONTAINER_ACTIONS = new Set<ContainerAction>(['kill', 'remove']);

/**
 * Container-Modul – Liste, Details, Aktionen, Logs und Stats.
 */
export const containersModule: FastifyPluginAsync = async (app: FastifyInstance) => {
  const service = new ContainersService({ docker: app.docker });

  app.get<{ Querystring: ContainerFilter }>(
    `${API_PREFIX}/containers`,
    async (request): Promise<ContainerSummary[]> => {
      return withDockerError(app, () => service.list(request.query));
    },
  );

  app.get<{ Params: { id: string } }>(
    `${API_PREFIX}/containers/:id/logs/stream`,
    async (request, reply) => {
      const tail = parseTail(request.query as { tail?: string });
      reply.hijack();
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      reply.raw.write(': dockora-container-logs\n\n');

      let closed = false;
      let streamHandle: { close: () => void } | null = null;

      try {
        streamHandle = await service.streamLogs(
          request.params.id,
          (chunk) => {
            if (closed) return;
            const lines = chunk.split('\n');
            for (const line of lines) {
              if (line.length === 0) continue;
              reply.raw.write(`data: ${JSON.stringify(line)}\n\n`);
            }
          },
          { tail },
        );
      } catch (error) {
        withDockerError(app, () => Promise.reject(error));
        return;
      }

      const cleanup = () => {
        if (closed) return;
        closed = true;
        streamHandle?.close();
      };

      request.raw.on('close', cleanup);
      request.raw.on('error', cleanup);
    },
  );

  app.get<{ Params: { id: string }; Querystring: { tail?: string } }>(
    `${API_PREFIX}/containers/:id/logs`,
    async (request): Promise<string> => {
      const tail = parseTail(request.query);
      return withDockerError(app, () => service.logs(request.params.id, tail));
    },
  );

  app.get<{ Params: { id: string } }>(
    `${API_PREFIX}/containers/:id/stats`,
    async (request): Promise<ContainerStatsSnapshot> => {
      return withDockerError(app, () => service.stats(request.params.id));
    },
  );

  app.post<{
    Params: { id: string; action: string };
    Body: { force?: boolean };
  }>(
    `${API_PREFIX}/containers/:id/:action`,
    {
      ...destructiveRateLimit,
      preHandler: [
        async (request) => {
          if (request.params.action === 'remove' || request.params.action === 'kill') {
            await app.requireRole('admin')(request);
          }
        },
      ],
    },
    async (request): Promise<ActionResult> => {
      const action = request.params.action as ContainerAction;
      if (!CONTAINER_ACTIONS.has(action)) {
        throw app.httpErrors.badRequest(`Unknown container action: ${request.params.action}`);
      }
      const result = await withDockerError(app, () =>
        service.action(request.params.id, action, request.body ?? {}),
      );
      if (DESTRUCTIVE_CONTAINER_ACTIONS.has(action)) {
        void auditService.record({
          action: `container.${action}`,
          actorId: actorIdFromRequest(request),
          resource: 'container',
          resourceId: request.params.id,
        });
      }
      return result;
    },
  );

  app.get<{ Params: { id: string } }>(
    `${API_PREFIX}/containers/:id`,
    async (request): Promise<ContainerDetails> => {
      return withDockerError(app, () => service.getDetails(request.params.id));
    },
  );
};

function parseTail(query: { tail?: string }): number {
  const raw = query.tail;
  if (!raw) return 200;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 200;
}
