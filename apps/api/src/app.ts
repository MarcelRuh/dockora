import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import sensible from '@fastify/sensible';
import type { AppConfig } from './config/env.js';
import type { IDockerClient, IHostMetrics } from './domain/ports.js';
import { createDockerClient } from './infrastructure/docker/dockerode-client.js';
import { LifetimeStatsService } from './infrastructure/stats/lifetime-stats.js';
import { HostMetricsService } from './infrastructure/system/host-metrics.js';
import { registerModules } from './modules/index.js';
import { errorHandler } from './presentation/http/error-handler.js';
import { requestIdHook } from './presentation/http/request-id.js';

export interface BuildAppDeps {
  config: AppConfig;
  logger: FastifyBaseLogger;
  docker?: IDockerClient;
  hostMetrics?: IHostMetrics;
  lifetime?: LifetimeStatsService;
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
  const lifetime = deps.lifetime ?? new LifetimeStatsService(docker, hostMetrics);

  app.decorate('config', config);
  app.decorate('docker', docker);
  app.decorate('hostMetrics', hostMetrics);
  app.decorate('lifetime', lifetime);

  await app.register(sensible);
  await app.register(helmet, {
    contentSecurityPolicy: false,
  });
  await app.register(cors, {
    origin: config.corsOrigin,
    credentials: true,
  });
  await app.register(rateLimit, {
    max: config.rateLimitMax,
    timeWindow: config.rateLimitTimeWindowMs,
  });

  app.addHook('onRequest', requestIdHook);
  app.setErrorHandler(errorHandler);

  await registerModules(app);

  app.addHook('onReady', async () => {
    docker.startEventListener();
    lifetime.start(15_000);
    logger.info('Docker event listener + lifetime stats started');
  });

  app.addHook('onClose', async () => {
    lifetime.stop();
    docker.stopEventListener();
  });

  return app;
}

declare module 'fastify' {
  interface FastifyInstance {
    config: AppConfig;
    docker: IDockerClient;
    hostMetrics: IHostMetrics;
    lifetime: LifetimeStatsService;
  }
}
