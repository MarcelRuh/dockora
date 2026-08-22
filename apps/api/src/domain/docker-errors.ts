import type { FastifyInstance } from 'fastify';
import {
  enrichPortConflictMessage,
  isPortConflictMessage,
} from './port-conflict.js';

interface DockerLikeError {
  statusCode?: number;
  status?: number;
  message?: string;
  reason?: string;
  json?: { message?: string };
}

async function resolveMessage(app: FastifyInstance, message: string): Promise<string> {
  if (!isPortConflictMessage(message) || !app.docker) return message;
  try {
    const containers = await app.docker.listContainers(true);
    return enrichPortConflictMessage(message, containers);
  } catch {
    return message;
  }
}

/**
 * Mappt Docker/Dockerode-Fehler auf Fastify sensible HTTP-Fehler.
 */
export async function throwDockerError(
  app: FastifyInstance,
  error: unknown,
): Promise<never> {
  const err = error as DockerLikeError;
  const statusCode = err.statusCode ?? err.status;
  let message =
    err.json?.message ??
    err.message ??
    err.reason ??
    (error instanceof Error ? error.message : 'Docker operation failed');

  message = await resolveMessage(app, message);

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
  if (message.toLowerCase().includes('no such volume')) {
    throw app.httpErrors.notFound(message);
  }
  if (isPortConflictMessage(message)) {
    throw app.httpErrors.badRequest(message);
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
    return await throwDockerError(app, error);
  }
}
