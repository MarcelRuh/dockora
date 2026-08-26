import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import sensible from '@fastify/sensible';
import type { AppConfig } from './config/env.js';
import type { IDockerClient, IHostMetrics } from './domain/ports.js';
import { createDockerClient } from './infrastructure/docker/dockerode-client.js';
import { HostMetricsService } from './infrastructure/system/host-metrics.js';
import { registerModules } from './modules/index.js';
import { errorHandler } from './presentation/http/error-handler.js';
import { requestIdHook } from './presentation/http/request-id.js';

export interface BuildAppDeps {
  config: AppConfig;
  logger: FastifyBaseLogger;
  docker?: IDockerClient;
  hostMetrics?: IHostMetrics;
}

export async function buildApp(deps: BuildAppDeps): Promise<FastifyInstance> {
  const { config, logger } = deps;

  const app = Fastify({
    loggerInstance: logger,
    trustProxy: true,
    requestIdHeader: 'x-request-id',
    genReqId: () => crypto.randomUUID(),
  });

  const docker = deps.docker ?? createDockerClient(config.dockerSocket, logger);
  const hostMetrics = deps.hostMetrics ?? new HostMetricsService();

  app.decorate('config', config);
  app.decorate('docker', docker);
  app.decorate('hostMetrics', hostMetrics);

  await app.register(sensible);
  await app.register(helmet, {
    contentSecurityPolicy: false,
  });
  await app.register(cors, {
    origin: config.corsOrigin,
    credentials: true,
  });
  await app.register(cookie);
  await app.register(rateLimit, {
    max: config.rateLimitMax,
    timeWindow: config.rateLimitTimeWindowMs,
  });

  app.addHook('onRequest', requestIdHook);
  app.setErrorHandler(errorHandler);

  await registerModules(app);

  app.addHook('onReady', async () => {
    docker.startEventListener();
    logger.info('Docker event listener started');
  });

  app.addHook('onClose', async () => {
    docker.stopEventListener();
  });

  return app;
}

declare module 'fastify' {
  interface FastifyInstance {
    config: AppConfig;
    docker: IDockerClient;
    hostMetrics: IHostMetrics;
  }
}
