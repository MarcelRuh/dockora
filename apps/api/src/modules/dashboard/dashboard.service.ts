import type {
  DashboardEvent,
  DashboardNotification,
  DashboardOverview,
} from '@dockora/shared';
import { summarizeContainers } from '../../domain/container-utils.js';
import { isDockoraSelfContainer } from '../../domain/dockora-self.js';
import type {
  IComposeVersionProvider,
  IDockerClient,
  IHostMetrics,
} from '../../domain/ports.js';

export interface DashboardServiceDeps {
  docker: IDockerClient;
  hostMetrics: IHostMetrics;
  composeVersion: IComposeVersionProvider;
  listNotifications?: () => Promise<DashboardNotification[]>;
}

export class DashboardService {
  constructor(private readonly deps: DashboardServiceDeps) {}

  async getOverview(): Promise<DashboardOverview> {
    const [engine, containersResult, resources, composeVersion, notifications] = await Promise.all([
      this.resolveEngine(),
      this.resolveContainers(),
      this.deps.hostMetrics.getResources('/'),
      this.deps.composeVersion.getVersion(),
      this.deps.listNotifications?.() ?? Promise.resolve([]),
    ]);

    return {
      containers: containersResult,
      resources: {
        cpuPercent: resources.cpuPercent,
        memoryUsedBytes: resources.memoryUsedBytes,
        memoryTotalBytes: resources.memoryTotalBytes,
        diskUsedBytes: resources.diskUsedBytes,
        diskTotalBytes: resources.diskTotalBytes,
      },
      docker: {
        engineVersion: engine.version,
        composeVersion,
        engineStatus: engine.status,
      },
      recentEvents: this.mapEvents(),
      notifications,
      updatesAvailable: 0,
    };
  }

  private async resolveEngine(): Promise<{
    status: 'online' | 'offline' | 'unknown';
    version: string | null;
  }> {
    try {
      const online = await this.deps.docker.ping();
      if (!online) {
        return { status: 'offline', version: null };
      }
      const version = await this.deps.docker.getVersion();
      return { status: 'online', version: version.version };
    } catch {
      return { status: 'offline', version: null };
    }
  }

  private async resolveContainers(): Promise<DashboardOverview['containers']> {
    try {
      const list = (await this.deps.docker.listContainers(true)).filter(
        (c) => !isDockoraSelfContainer(c),
      );
      return summarizeContainers(list);
    } catch {
      return { total: 0, running: 0, stopped: 0, unhealthy: 0 };
    }
  }

  private mapEvents(): DashboardEvent[] {
    return this.deps.docker.getRecentEvents(15).map((e) => ({
      id: e.id,
      type: `${e.type}.${e.action}`,
      message: e.message,
      timestamp: e.timestamp,
      containerId: e.containerId,
      containerName: e.containerName,
    }));
  }
}
