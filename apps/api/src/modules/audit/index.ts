import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { API_PREFIX } from '@dockora/shared';
import { auditService } from './audit.service.js';

export const auditModule: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.get<{
    Querystring: {
      limit?: string;
      action?: string;
      actorId?: string;
      resource?: string;
      since?: string;
      until?: string;
    };
  }>(`${API_PREFIX}/audit`, { preHandler: [app.requireRole('admin')] }, async (request) => {
    const limit = request.query.limit ? Number(request.query.limit) : 50;
    return auditService.list({
      limit: Number.isFinite(limit) ? limit : 50,
      action: request.query.action,
      actorId: request.query.actorId,
      resource: request.query.resource,
      since: request.query.since,
      until: request.query.until,
    });
  });
};

export { AuditService, auditService } from './audit.service.js';
