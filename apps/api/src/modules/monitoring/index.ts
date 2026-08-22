import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { API_PREFIX, type MonitoringSnapshot } from '@dockora/shared';
import {
  PrismaSettingsRepository,
  SettingsService,
} from '../settings/settings.service.js';
import { MonitoringService } from './monitoring.service.js';

export const monitoringModule: FastifyPluginAsync = async (app: FastifyInstance) => {
  const settings = new SettingsService(new PrismaSettingsRepository());
  const service = new MonitoringService({
    docker: app.docker,
    hostMetrics: app.hostMetrics,
    settings,
  });

  app.get(`${API_PREFIX}/monitoring`, async (): Promise<MonitoringSnapshot> => {
    return service.getSnapshot();
  });
};

export { MonitoringService };
