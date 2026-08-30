import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { API_PREFIX } from '@dockora/shared';

const PING_MS = 25_000;
const COALESCE_MS = 400;

/**
 * Compact Docker resource SSE – one `change` event after start/stop/pull/etc.
 * List pages subscribe and refresh instead of polling every 15s.
 */
export const eventsModule: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.get(`${API_PREFIX}/events/stream`, async (request, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    reply.raw.write(': dockora-events-stream\n\n');

    let closed = false;
    let coalesce: ReturnType<typeof setTimeout> | null = null;
    let pending: { type: string; action: string } | null = null;

    const flush = () => {
      coalesce = null;
      if (closed || !pending) return;
      const payload = pending;
      pending = null;
      reply.raw.write(`event: change\ndata: ${JSON.stringify(payload)}\n\n`);
    };

    const unsub = app.docker.subscribeResourceChanges((event) => {
      if (closed) return;
      pending = event;
      if (coalesce) return;
      coalesce = setTimeout(flush, COALESCE_MS);
    });

    const ping = setInterval(() => {
      if (!closed) reply.raw.write(': ping\n\n');
    }, PING_MS);

    const cleanup = () => {
      if (closed) return;
      closed = true;
      unsub();
      if (coalesce) clearTimeout(coalesce);
      clearInterval(ping);
    };

    request.raw.on('close', cleanup);
    request.raw.on('error', cleanup);
  });
};
