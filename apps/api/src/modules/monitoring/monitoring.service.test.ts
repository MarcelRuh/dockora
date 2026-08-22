import { describe, expect, it } from 'vitest';
import type { IDockerClient, IHostMetrics } from '../../domain/ports.js';
import type { SettingsService } from '../settings/settings.service.js';
import { MonitoringService } from './monitoring.service.js';

function docker(containers: Awaited<ReturnType<IDockerClient['listContainers']>>): IDockerClient {
  return {
    ping: async () => true,
    listContainers: async () => containers,
    getBuildCacheBytes: async () => 0,
  } as unknown as IDockerClient;
}

function hostMetrics(): IHostMetrics {
  return {
    getResources: async () => ({
      cpuPercent: 10,
      cpuCores: 4,
      memoryUsedBytes: 1,
      memoryTotalBytes: 10,
      diskUsedBytes: 1,
      diskTotalBytes: 10,
      diskPath: '/',
      temperatureC: 40,
    }),
  };
}

function settings(): SettingsService {
  return {
    getSettings: async () => ({
      monitoringCpuThreshold: 95,
      monitoringRamThreshold: 95,
      monitoringDiskThreshold: 95,
      monitoringTempThreshold: 95,
      monitoringBuildCacheGbThreshold: 0,
    }),
  } as unknown as SettingsService;
}

describe('MonitoringService', () => {
  it('hides the self-updater and its alerts', async () => {
    const service = new MonitoringService({
      docker: docker([
        {
          id: '1',
          name: 'plex',
          image: 'plexinc/pms-docker',
          status: 'running',
          state: 'Up',
          createdAt: new Date().toISOString(),
          labels: {},
          ports: [],
          networks: [],
        },
        {
          id: '2',
          name: 'dockora-self-updater',
          image: 'docker:27-cli',
          status: 'exited',
          state: 'Exited (0)',
          createdAt: new Date().toISOString(),
          labels: { 'dockora.update': 'self' },
          ports: [],
          networks: [],
        },
      ]),
      hostMetrics: hostMetrics(),
      settings: settings(),
    });

    const snap = await service.getSnapshot();
    expect(snap.containers.map((c) => c.name)).toEqual(['plex']);
    expect(snap.alerts.some((a) => /updater/i.test(a))).toBe(false);
  });
});
