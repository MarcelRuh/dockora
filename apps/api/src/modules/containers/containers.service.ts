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
import { mapPool } from '../../infrastructure/async/map-pool.js';
import {
  COMPOSE_PROJECT_LABEL,
  COMPOSE_WORKING_DIR_LABEL,
  deleteProjectDirectory,
} from '../compose/safe-project-dir.js';

export interface ContainersServiceDeps {
  docker: IDockerClient;
  /** Compose search paths – used when deleting project folders after container remove. */
  searchPaths?: string[];
}

const STATS_CACHE_TTL_MS = 12_000;
const STATS_CACHE_MAX = 200;
const STATS_WARM_MS = 20_000;

export class ContainersService {
  private readonly statsCache = new Map<
    string,
    { expiresAt: number; stats: ContainerStatsSnapshot }
  >();
  private warmTimer: ReturnType<typeof setInterval> | null = null;
  private warming = false;

  constructor(private readonly deps: ContainersServiceDeps) {}

  startStatsWarmer(): void {
    if (this.warmTimer) return;
    this.warmTimer = setInterval(() => void this.warmRunningStats(), STATS_WARM_MS);
    void this.warmRunningStats();
  }

  stopStatsWarmer(): void {
    if (this.warmTimer) {
      clearInterval(this.warmTimer);
      this.warmTimer = null;
    }
  }

  async list(filters: ContainerFilter = {}): Promise<ContainerSummary[]> {
    const needStopped =
      !filters.status || filters.status === 'all' || filters.status === 'exited';
    const all = await this.deps.docker.listContainers(needStopped);
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
      void this.warmRunningStats();
      return summaries;
    }

    await mapPool(summaries, 4, async (summary) => {
      if (summary.status !== 'running') {
        summary.cpuPercent = null;
        summary.memoryPercent = null;
        summary.memoryUsageBytes = null;
        return;
      }
      try {
        const stats = await this.stats(summary.id);
        summary.cpuPercent = stats.cpuPercent;
        summary.memoryPercent = stats.memoryPercent;
        summary.memoryUsageBytes = stats.memoryUsageBytes;
      } catch {
        summary.cpuPercent = null;
        summary.memoryPercent = null;
        summary.memoryUsageBytes = null;
      }
    });

    return summaries;
  }

  async warmRunningStats(): Promise<void> {
    if (this.warming) return;
    this.warming = true;
    try {
      const running = await this.deps.docker.listContainers(false);
      await mapPool(running, 4, async (container) => {
        if (container.status !== 'running') return;
        try {
          await this.stats(container.id);
        } catch {
          // ignore
        }
      });
    } catch {
      // docker offline
    } finally {
      this.warming = false;
    }
  }

  async getDetails(id: string): Promise<ContainerDetails> {
    const details = await this.deps.docker.inspectContainer(id);
    return toDetails(details);
  }

  async action(
    id: string,
    action: ContainerAction,
    options?: { force?: boolean; deleteProjectDir?: boolean },
  ): Promise<ActionResult> {
    this.statsCache.delete(id);

    let projectMeta: { workingDir: string; projectName: string } | null = null;
    if (action === 'remove' && options?.deleteProjectDir !== false) {
      try {
        const details = await this.deps.docker.inspectContainer(id);
        const workingDir = details.labels[COMPOSE_WORKING_DIR_LABEL]?.trim();
        const projectName =
          details.labels[COMPOSE_PROJECT_LABEL]?.trim() || details.composeProject?.trim();
        if (workingDir && projectName) {
          projectMeta = { workingDir, projectName };
        }
      } catch {
        // inspect failed – still try remove
      }
    }

    await this.deps.docker.containerAction(id, action, options);

    if (action === 'remove' && projectMeta && options?.deleteProjectDir !== false) {
      const folderMsg = await this.maybeDeleteComposeProjectDir(projectMeta);
      if (folderMsg) {
        return { ok: true, message: `Container remove succeeded. ${folderMsg}` };
      }
    }

    return { ok: true, message: `Container ${action} succeeded` };
  }

  /**
   * Deletes the Compose project folder when no containers of that project remain.
   */
  private async maybeDeleteComposeProjectDir(meta: {
    workingDir: string;
    projectName: string;
  }): Promise<string | null> {
    const searchPaths = this.deps.searchPaths ?? [];
    if (searchPaths.length === 0) return null;

    const remaining = (await this.deps.docker.listContainers(true)).filter((c) => {
      const name = c.labels[COMPOSE_PROJECT_LABEL] || c.composeProject;
      const dir = c.labels[COMPOSE_WORKING_DIR_LABEL];
      return name === meta.projectName || dir === meta.workingDir;
    });

    if (remaining.length > 0) {
      return null;
    }

    try {
      await deleteProjectDirectory(meta.workingDir, searchPaths);
      return `Project folder deleted (${meta.workingDir}).`;
    } catch (error) {
      return `Project folder not deleted: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  async logs(id: string, tail = 200): Promise<string> {
    return this.deps.docker.getContainerLogs(id, { tail, stdout: true, stderr: true });
  }

  async stats(id: string): Promise<ContainerStatsSnapshot> {
    const cached = this.statsCache.get(id);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.stats;
    }
    const stats = await this.deps.docker.getContainerStats(id);
    this.statsCache.set(id, { expiresAt: Date.now() + STATS_CACHE_TTL_MS, stats });
    this.pruneStatsCache();
    return stats;
  }

  private pruneStatsCache(): void {
    const now = Date.now();
    for (const [id, entry] of this.statsCache) {
      if (entry.expiresAt <= now) this.statsCache.delete(id);
    }
    if (this.statsCache.size <= STATS_CACHE_MAX) return;
    const extra = this.statsCache.size - STATS_CACHE_MAX;
    const keys = [...this.statsCache.keys()].slice(0, extra);
    for (const key of keys) this.statsCache.delete(key);
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
