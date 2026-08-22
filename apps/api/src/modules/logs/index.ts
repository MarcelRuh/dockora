import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { API_PREFIX, type LogEntry, type LogLevel } from '@dockora/shared';
import { LogsService } from './logs.service.js';

export const logsModule: FastifyPluginAsync = async (app: FastifyInstance) => {
  const service = new LogsService({ docker: app.docker });

  app.get<{
    Querystring: {
      container?: string;
      level?: LogLevel;
      q?: string;
      limit?: string;
      since?: string;
    };
  }>(`${API_PREFIX}/logs`, async (request): Promise<LogEntry[]> => {
    const { container, level, q, since } = request.query;
    const limit = request.query.limit ? Number(request.query.limit) : undefined;

    return service.aggregate({ container, level, q, limit, since });
  });
};

export { LogsService };
