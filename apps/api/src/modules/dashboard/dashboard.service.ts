import type {
  DashboardEvent,
  DashboardNotification,
  DashboardOverview,
} from '@dockora/shared';
import { isUnhealthyContainer, summarizeContainers } from '../../domain/container-utils.js';
import { isDockoraSelfContainer } from '../../domain/dockora-self.js';
import type {
  IComposeVersionProvider,
  IDockerClient,
  IHostMetrics,
} from '../../domain/ports.js';
import { dockerUpdateAvailable } from '../system/docker-host-versions.js';

export interface DashboardDockerLatest {
  engine: string | null;
  compose: string | null;
}

export interface DashboardServiceDeps {
  docker: IDockerClient;
  hostMetrics: IHostMetrics;
  composeVersion: IComposeVersionProvider;
  listNotifications?: () => Promise<DashboardNotification[]>;
  dockerLatest?: () => Promise<DashboardDockerLatest>;
}

export class DashboardService {
  constructor(private readonly deps: DashboardServiceDeps) {}

  async getOverview(): Promise<DashboardOverview> {
    const [engine, containersResult, resources, composeVersion, notifications, latest] =
      await Promise.all([
        this.resolveEngine(),
        this.resolveContainers(),
        this.deps.hostMetrics.getResources('/'),
        this.deps.composeVersion.getVersion(),
        this.deps.listNotifications?.() ?? Promise.resolve([]),
        this.deps.dockerLatest?.() ?? Promise.resolve({ engine: null, compose: null }),
      ]);

    return {
      containers: containersResult.summary,
      unhealthyContainers: containersResult.unhealthy,
      resources: {
        cpuPercent: resources.cpuPercent,
        cpuCores: resources.cpuCores,
        memoryUsedBytes: resources.memoryUsedBytes,
        memoryTotalBytes: resources.memoryTotalBytes,
        diskUsedBytes: resources.diskUsedBytes,
        diskTotalBytes: resources.diskTotalBytes,
      },
      docker: {
        engineVersion: engine.version,
        composeVersion,
        engineStatus: engine.status,
        engineLatest: latest.engine,
        composeLatest: latest.compose,
        engineUpdateAvailable: dockerUpdateAvailable(engine.version, latest.engine),
        composeUpdateAvailable: dockerUpdateAvailable(composeVersion, latest.compose),
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
      const version = await this.deps.docker.getVersion();
      return { status: 'online', version: version.version };
    } catch {
      return { status: 'offline', version: null };
    }
  }

  private async resolveContainers(): Promise<{
    summary: DashboardOverview['containers'];
    unhealthy: DashboardOverview['unhealthyContainers'];
  }> {
    try {
      const list = (await this.deps.docker.listContainers(true)).filter(
        (c) => !isDockoraSelfContainer(c),
      );
      return {
        summary: summarizeContainers(list),
        unhealthy: list
          .filter((c) => isUnhealthyContainer(c))
          .map((c) => ({
            id: c.id,
            name: c.name,
            composeProject: c.composeProject,
          })),
      };
    } catch {
      return {
        summary: { total: 0, running: 0, stopped: 0, unhealthy: 0 },
        unhealthy: [],
      };
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
