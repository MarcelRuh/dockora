/**
 * Domain-Schicht: Entities, Value Objects und Ports (Interfaces).
 */

import type { ContainerStatus } from '@dockora/shared';

export interface DockerVersionInfo {
  version: string;
  apiVersion: string;
  platformName?: string;
  os?: string;
  arch?: string;
}

export interface DockerContainerInfo {
  id: string;
  name: string;
  image: string;
  imageId?: string;
  status: ContainerStatus;
  state: string;
  createdAt: string;
  startedAt?: string;
  health?: 'healthy' | 'unhealthy' | 'starting' | 'none';
  exitCode?: number;
  labels: Record<string, string>;
  ports: string[];
  networks: string[];
  composeProject?: string;
  /** Label com.docker.compose.service */
  composeService?: string;
}

export interface DockerContainerDetails extends DockerContainerInfo {
  env: string[];
  mounts: Array<{ source: string; destination: string; mode?: string; type?: string }>;
  networkMode?: string;
  restartPolicy?: string;
  command?: string;
  platform?: string;
  sizeRw?: number;
  sizeRootFs?: number;
}

export interface DockerStatsSnapshot {
  cpuPercent: number;
  memoryUsageBytes: number;
  memoryLimitBytes: number;
  memoryPercent: number;
  netRxBytes: number;
  netTxBytes: number;
  blockReadBytes: number;
  blockWriteBytes: number;
  timestamp: string;
}

export interface DockerImageInfo {
  id: string;
  tags: string[];
  size: number;
  createdAt: string;
  dangling: boolean;
  digests: string[];
}

export interface DockerEventInfo {
  id: string;
  type: string;
  action: string;
  message: string;
  timestamp: string;
  containerId?: string;
  containerName?: string;
}

export interface IDockerClient {
  ping(): Promise<boolean>;
  getVersion(): Promise<DockerVersionInfo>;
  listContainers(all?: boolean): Promise<DockerContainerInfo[]>;
  inspectContainer(id: string): Promise<DockerContainerDetails>;
  containerAction(
    id: string,
    action: 'start' | 'stop' | 'restart' | 'kill' | 'pause' | 'unpause' | 'remove',
    options?: { force?: boolean; timeout?: number },
  ): Promise<void>;
  getContainerLogs(
    id: string,
    options?: { tail?: number; timestamps?: boolean; stdout?: boolean; stderr?: boolean },
  ): Promise<string>;
  streamContainerLogs(
    id: string,
    onData: (chunk: string) => void,
    options?: { tail?: number },
  ): Promise<{ close: () => void }>;
  getContainerStats(id: string): Promise<DockerStatsSnapshot>;
  listImages(): Promise<DockerImageInfo[]>;
  pullImage(image: string): Promise<void>;
  removeImage(id: string, force?: boolean): Promise<void>;
  pruneImages(danglingOnly?: boolean): Promise<{ imagesDeleted: number; spaceReclaimed: number }>;
  getImageInspect(id: string): Promise<{ Id: string; RepoDigests?: string[]; RepoTags?: string[] }>;
  /** Low-level dockerode instance for exec/attach (terminal) */
  getRaw(): unknown;
  getRecentEvents(limit?: number): DockerEventInfo[];
  startEventListener(): void;
  stopEventListener(): void;
}

export interface HostResources {
  cpuPercent: number | null;
  memoryUsedBytes: number;
  memoryTotalBytes: number;
  diskUsedBytes: number | null;
  diskTotalBytes: number | null;
  diskPath: string;
  temperatureC: number | null;
}

export interface IHostMetrics {
  getResources(diskPath?: string): Promise<HostResources>;
}

export interface IComposeVersionProvider {
  getVersion(): Promise<string | null>;
}

export interface ISettingsRepository {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  getAll(): Promise<Record<string, string>>;
}

export interface DockoraPlugin {
  readonly name: string;
  readonly version: string;
  register(): Promise<void>;
  unregister?(): Promise<void>;
}
