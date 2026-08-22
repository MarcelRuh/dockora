import type { FastifyReply, FastifyRequest } from 'fastify';

/** Stellt sicher, dass jede Response eine Request-ID trägt. */
export async function requestIdHook(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  void reply.header('x-request-id', request.id);
}
