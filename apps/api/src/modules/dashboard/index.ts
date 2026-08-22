import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { API_PREFIX, type DashboardOverview } from '@dockora/shared';
import { ComposeVersionProvider } from '../../infrastructure/docker/compose-version.js';
import { prisma } from '../../infrastructure/db/prisma.js';
import { DockerHostUpdateService } from '../system/docker-host-update.service.js';
import { DashboardService } from './dashboard.service.js';

const SSE_INTERVAL_MS = 10_000;

export const dashboardModule: FastifyPluginAsync = async (app: FastifyInstance) => {
  const dockerHostUpdates = new DockerHostUpdateService();
  const service = new DashboardService({
    docker: app.docker,
    hostMetrics: app.hostMetrics,
    composeVersion: new ComposeVersionProvider(),
    dockerLatest: () => dockerHostUpdates.latest(),
    listNotifications: async () => {
      const rows = await prisma.notification.findMany({
        orderBy: { createdAt: 'desc' },
        take: 20,
      });
      return rows.map((n) => ({
        id: n.id,
        severity: n.severity as 'info' | 'warning' | 'error' | 'success',
        title: n.title,
        message: n.message,
        timestamp: n.createdAt.toISOString(),
        read: n.read,
      }));
    },
  });

  const getOverview = async (): Promise<DashboardOverview> => {
    const overview = await service.getOverview();
    const updatesAvailable = await prisma.updateCheckCache.count({
      where: { updateAvailable: true },
    });
    return { ...overview, updatesAvailable };
  };

  app.get(
    `${API_PREFIX}/dashboard`,
    async (_request, _reply): Promise<DashboardOverview> => getOverview(),
  );

  app.get(`${API_PREFIX}/dashboard/stream`, async (request, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    reply.raw.write(': dockora-dashboard-stream\n\n');

    let closed = false;

    const send = async () => {
      if (closed) return;
      try {
        const overview = await getOverview();
        reply.raw.write(`event: dashboard\ndata: ${JSON.stringify(overview)}\n\n`);
      } catch (error) {
        request.log.warn({ err: error }, 'SSE dashboard push failed');
        reply.raw.write(
          `event: error\ndata: ${JSON.stringify({ message: 'dashboard_update_failed' })}\n\n`,
        );
      }
    };

    await send();
    const timer = setInterval(() => void send(), SSE_INTERVAL_MS);

    const cleanup = () => {
      if (closed) return;
      closed = true;
      clearInterval(timer);
    };

    request.raw.on('close', cleanup);
    request.raw.on('error', cleanup);
  });
};
