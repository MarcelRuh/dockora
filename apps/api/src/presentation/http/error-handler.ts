import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import type { ApiErrorBody } from '@dockora/shared';

/**
 * Zentrale Fehlerbehandlung – liefert konsistente API-Error-Bodies.
 */
export function errorHandler(
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply,
): void {
  const statusCode = error.statusCode ?? 500;
  const body: ApiErrorBody = {
    statusCode,
    error: error.name || 'Error',
    message:
      statusCode >= 500 && process.env.NODE_ENV === 'production'
        ? 'Internal Server Error'
        : error.message,
    requestId: request.id,
  };

  if (statusCode >= 500) {
    request.log.error({ err: error, requestId: request.id }, 'Unhandled error');
  } else {
    request.log.warn({ err: error, requestId: request.id }, 'Request error');
  }

  void reply.status(statusCode).send(body);
}
