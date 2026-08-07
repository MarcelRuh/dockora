import type { MonitoringSnapshot, ContainerStatus } from '@dockora/shared';
import type { IDockerClient, IHostMetrics } from '../../domain/ports.js';
import type { SettingsService } from '../settings/settings.service.js';

export interface MonitoringServiceDeps {
  docker: IDockerClient;
  hostMetrics: IHostMetrics;
  settings: SettingsService;
}

export class MonitoringService {
  constructor(private readonly deps: MonitoringServiceDeps) {}

  async getSnapshot(): Promise<MonitoringSnapshot> {
    const settings = await this.deps.settings.getSettings();
    const alerts: string[] = [];

    let dockerOnline = false;
    let containers: MonitoringSnapshot['containers'] = [];
    let buildCacheBytes: number | null = null;

    try {
      dockerOnline = await this.deps.docker.ping();
      if (dockerOnline) {
        const list = await this.deps.docker.listContainers(true);
        containers = list.map((c) => {
          const entry: MonitoringSnapshot['containers'][number] = {
            id: c.id,
            name: c.name,
            status: c.status as ContainerStatus,
          };

          if (c.health === 'unhealthy') {
            entry.alert = 'Container health check failed';
            alerts.push(`${c.name}: unhealthy`);
          } else if (c.status === 'exited' && c.state.includes('Exited')) {
            entry.alert = 'Container exited';
            alerts.push(`${c.name}: exited`);
          }

          return entry;
        });

        buildCacheBytes = await this.deps.docker.getBuildCacheBytes();
        const cacheGb = buildCacheBytes / (1024 ** 3);
        const cacheLimit = settings.monitoringBuildCacheGbThreshold;
        if (cacheLimit > 0 && cacheGb >= cacheLimit) {
          alerts.push(
            `Docker build cache ${cacheGb.toFixed(1)} GB exceeds ${cacheLimit} GB threshold`,
          );
        }
      } else {
        alerts.push('Docker daemon offline');
      }
    } catch {
      alerts.push('Docker unreachable');
    }

    const resources = await this.deps.hostMetrics.getResources('/');

    const memoryPercent =
      resources.memoryTotalBytes > 0
        ? round1((resources.memoryUsedBytes / resources.memoryTotalBytes) * 100)
        : null;

    const diskPercent =
      resources.diskTotalBytes && resources.diskUsedBytes !== null
        ? round1((resources.diskUsedBytes / resources.diskTotalBytes) * 100)
        : null;

    if (resources.cpuPercent !== null && resources.cpuPercent >= settings.monitoringCpuThreshold) {
      alerts.push(`CPU usage ${resources.cpuPercent}% exceeds threshold`);
    }
    if (memoryPercent !== null && memoryPercent >= settings.monitoringRamThreshold) {
      alerts.push(`Memory usage ${memoryPercent}% exceeds threshold`);
    }
    if (diskPercent !== null && diskPercent >= settings.monitoringDiskThreshold) {
      const freeGb =
        resources.diskTotalBytes != null && resources.diskUsedBytes != null
          ? ((resources.diskTotalBytes - resources.diskUsedBytes) / 1024 ** 3).toFixed(1)
          : '?';
      alerts.push(
        `Disk usage ${diskPercent}% exceeds ${settings.monitoringDiskThreshold}% threshold (${freeGb} GB free)`,
      );
    }
    if (resources.temperatureC !== null && resources.temperatureC >= 85) {
      alerts.push(`High temperature: ${resources.temperatureC}°C`);
    }

    return {
      containers,
      host: {
        cpuPercent: resources.cpuPercent,
        memoryPercent,
        diskPercent,
        buildCacheBytes,
        temperatureC: resources.temperatureC,
      },
      dockerOnline,
      alerts,
      timestamp: new Date().toISOString(),
    };
  }
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
