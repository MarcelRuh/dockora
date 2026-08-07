import type {
  ActionResult,
  ContainerAction,
  ContainerDetails,
  ContainerFilter,
  ContainerStatsSnapshot,
  ContainerSummary,
} from '@dockora/shared';
import { isDockoraSelfContainer } from '../../domain/dockora-self.js';
import type { DockerContainerDetails, DockerContainerInfo, IDockerClient } from '../../domain/ports.js';

export interface ContainersServiceDeps {
  docker: IDockerClient;
}

export class ContainersService {
  constructor(private readonly deps: ContainersServiceDeps) {}

  async list(filters: ContainerFilter = {}): Promise<ContainerSummary[]> {
    const all = await this.deps.docker.listContainers(true);
    const includeSelf =
      filters.includeSelf === true ||
      filters.includeSelf === 'true' ||
      filters.includeSelf === '1';
    const includeStats =
      filters.includeStats === true ||
      filters.includeStats === 'true' ||
      filters.includeStats === '1';

    const summaries = all
      .filter((c) => includeSelf || !isDockoraSelfContainer(c))
      .filter((c) => this.matchesFilter(c, filters))
      .map(toSummary);

    if (!includeStats) {
      return summaries;
    }

    await Promise.all(
      summaries.map(async (summary) => {
        if (summary.status !== 'running') {
          summary.cpuPercent = null;
          summary.memoryPercent = null;
          summary.memoryUsageBytes = null;
          return;
        }
        try {
          const stats = await this.deps.docker.getContainerStats(summary.id);
          summary.cpuPercent = stats.cpuPercent;
          summary.memoryPercent = stats.memoryPercent;
          summary.memoryUsageBytes = stats.memoryUsageBytes;
        } catch {
          summary.cpuPercent = null;
          summary.memoryPercent = null;
          summary.memoryUsageBytes = null;
        }
      }),
    );

    return summaries;
  }

  async getDetails(id: string): Promise<ContainerDetails> {
    const details = await this.deps.docker.inspectContainer(id);
    return toDetails(details);
  }

  async action(
    id: string,
    action: ContainerAction,
    options?: { force?: boolean },
  ): Promise<ActionResult> {
    await this.deps.docker.containerAction(id, action, options);
    return { ok: true, message: `Container ${action} succeeded` };
  }

  async logs(id: string, tail = 200): Promise<string> {
    return this.deps.docker.getContainerLogs(id, { tail, stdout: true, stderr: true });
  }

  async stats(id: string): Promise<ContainerStatsSnapshot> {
    return this.deps.docker.getContainerStats(id);
  }

  streamLogs(
    id: string,
    onData: (chunk: string) => void,
    options?: { tail?: number },
  ): Promise<{ close: () => void }> {
    return this.deps.docker.streamContainerLogs(id, onData, options);
  }

  private matchesFilter(c: DockerContainerInfo, filters: ContainerFilter): boolean {
    if (filters.name) {
      const needle = filters.name.toLowerCase();
      if (!c.name.toLowerCase().includes(needle)) return false;
    }
    if (filters.status && filters.status !== 'all' && c.status !== filters.status) {
      return false;
    }
    if (filters.image) {
      const needle = filters.image.toLowerCase();
      if (!c.image.toLowerCase().includes(needle)) return false;
    }
    if (filters.label) {
      const [key, value] = filters.label.includes('=')
        ? filters.label.split('=', 2)
        : [filters.label, undefined];
      if (!(key in c.labels)) return false;
      if (value !== undefined && c.labels[key] !== value) return false;
    }
    if (filters.network) {
      const needle = filters.network.toLowerCase();
      if (!c.networks.some((n) => n.toLowerCase().includes(needle))) return false;
    }
    return true;
  }
}

function toSummary(c: DockerContainerInfo): ContainerSummary {
  return {
    id: c.id,
    name: c.name,
    image: c.image,
    status: c.status,
    state: c.state,
    createdAt: c.createdAt,
    ports: c.ports,
    labels: c.labels,
    networks: c.networks,
    composeProject: c.composeProject,
    health: c.health,
  };
}

function toDetails(c: DockerContainerDetails): ContainerDetails {
  return {
    ...toSummary(c),
    env: c.env,
    mounts: c.mounts,
    networkMode: c.networkMode,
    restartPolicy: c.restartPolicy,
    command: c.command,
    platform: c.platform,
    sizeRw: c.sizeRw,
    sizeRootFs: c.sizeRootFs,
  };
}
