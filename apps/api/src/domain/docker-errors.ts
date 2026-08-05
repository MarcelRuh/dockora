import type { FastifyInstance } from 'fastify';

interface DockerLikeError {
  statusCode?: number;
  status?: number;
  message?: string;
  reason?: string;
  json?: { message?: string };
}

/**
 * Mappt Docker/Dockerode-Fehler auf Fastify sensible HTTP-Fehler.
 */
export function throwDockerError(app: FastifyInstance, error: unknown): never {
  const err = error as DockerLikeError;
  const statusCode = err.statusCode ?? err.status;
  const message =
    err.json?.message ??
    err.message ??
    err.reason ??
    (error instanceof Error ? error.message : 'Docker operation failed');

  if (statusCode === 404) {
    throw app.httpErrors.notFound(message);
  }
  if (statusCode === 400 || statusCode === 409 || statusCode === 304) {
    throw app.httpErrors.badRequest(message);
  }
  if (message.toLowerCase().includes('no such container')) {
    throw app.httpErrors.notFound(message);
  }
  if (message.toLowerCase().includes('no such image')) {
    throw app.httpErrors.notFound(message);
  }
  throw app.httpErrors.internalServerError(message);
}

export async function withDockerError<T>(
  app: FastifyInstance,
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    throwDockerError(app, error);
  }
}
