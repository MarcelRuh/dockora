import type {
  BackupFormat,
  ComposeAction,
  ComposeProjectStatus,
  ContainerAction,
  ContainerStatus,
  JobType,
  LogLevel,
  NotificationEvent,
  RegistryProvider,
  SchedulePreset,
  UserRole,
} from '../types/index.js';

export interface HealthResponse {
  status: 'ok' | 'degraded' | 'error';
  version: string;
  uptimeSeconds: number;
  timestamp: string;
  docker?: {
    connected: boolean;
    engineVersion?: string;
  };
}

export interface DashboardOverview {
  containers: {
    total: number;
    running: number;
    stopped: number;
    unhealthy: number;
  };
  resources: {
    cpuPercent: number | null;
    memoryUsedBytes: number | null;
    memoryTotalBytes: number | null;
    diskUsedBytes: number | null;
    diskTotalBytes: number | null;
  };
  docker: {
    engineVersion: string | null;
    composeVersion: string | null;
    engineStatus: 'online' | 'offline' | 'unknown';
  };
  lifetime: {
    trackingSince: string;
    samplesCount: number;
    peakCpuPercent: number;
    peakMemoryPercent: number;
    peakDiskPercent: number;
    avgCpuPercent: number | null;
    avgMemoryPercent: number | null;
    avgDiskPercent: number | null;
    containerStarts: number;
    containerStops: number;
    containerDies: number;
    containerRestarts: number;
    maxContainersSeen: number;
    lastSampleAt: string | null;
  };
  recentEvents: DashboardEvent[];
  notifications: DashboardNotification[];
  updatesAvailable: number;
}

export interface DashboardEvent {
  id: string;
  type: string;
  message: string;
  timestamp: string;
  containerId?: string;
  containerName?: string;
}

export interface DashboardNotification {
  id: string;
  severity: 'info' | 'warning' | 'error' | 'success';
  title: string;
  message: string;
  timestamp: string;
  read: boolean;
}

export interface ContainerSummary {
  id: string;
  name: string;
  image: string;
  status: ContainerStatus;
  state: string;
  createdAt: string;
  ports: string[];
  labels: Record<string, string>;
  networks: string[];
  composeProject?: string;
  health?: 'healthy' | 'unhealthy' | 'starting' | 'none';
}

export interface ContainerDetails extends ContainerSummary {
  env: string[];
  mounts: Array<{ source: string; destination: string; mode?: string; type?: string }>;
  networkMode?: string;
  restartPolicy?: string;
  command?: string;
  platform?: string;
  sizeRw?: number;
  sizeRootFs?: number;
}

export interface ContainerStatsSnapshot {
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

export interface ContainerFilter {
  name?: string;
  status?: ContainerStatus | 'all';
  image?: string;
  label?: string;
  network?: string;
}

export interface ComposeProjectSummary {
  id: string;
  name: string;
  path: string;
  composeFile: string;
  status: ComposeProjectStatus;
  containerCount: number;
  runningCount: number;
  version?: string;
}

export interface ComposeProjectDetails extends ComposeProjectSummary {
  yaml: string;
  services: string[];
  envFiles: string[];
}

export interface ImageSummary {
  id: string;
  tags: string[];
  size: number;
  createdAt: string;
  dangling: boolean;
  usedBy: string[];
}

export interface UpdateCheckResult {
  containerId: string;
  containerName: string;
  image: string;
  currentDigest: string | null;
  remoteDigest: string | null;
  updateAvailable: boolean;
  registry: RegistryProvider;
  currentTag: string;
  checkedAt: string;
  error?: string;
}

export interface BackupInfo {
  id: string;
  name: string;
  format: BackupFormat;
  sizeBytes: number;
  createdAt: string;
  path: string;
  includes: string[];
}

export interface ScheduledJob {
  id: string;
  type: JobType;
  cron: string;
  preset?: SchedulePreset;
  enabled: boolean;
  lastRunAt?: string;
  nextRunAt?: string;
}

export interface AppSettings {
  dockerSocket: string;
  composeSearchPaths: string[];
  discordWebhookUrl: string;
  discordEnabled: boolean;
  discordEvents: NotificationEvent[];
  locale: 'de' | 'en';
  theme: 'dark' | 'light' | 'system';
  timezone: string;
  updateCheckIntervalMinutes: number;
  autoUpdateImages: boolean;
  backupRetentionDays: number;
  backupFormat: BackupFormat;
  backupSchedule: SchedulePreset | 'off';
  monitoringCpuThreshold: number;
  monitoringRamThreshold: number;
  monitoringDiskThreshold: number;
  authEnabled: boolean;
}

export interface AuthUser {
  id: string;
  email: string;
  displayName: string | null;
  role: UserRole;
}

export interface AuthStatusResponse {
  authEnabled: boolean;
}

export interface AuthLoginResponse {
  token: string;
  user: AuthUser;
}

export interface LogEntry {
  id: string;
  containerId?: string;
  containerName?: string;
  level: LogLevel;
  message: string;
  timestamp: string;
}

export interface MonitoringSnapshot {
  containers: Array<{
    id: string;
    name: string;
    status: ContainerStatus;
    alert?: string;
  }>;
  host: {
    cpuPercent: number | null;
    memoryPercent: number | null;
    diskPercent: number | null;
    temperatureC: number | null;
  };
  dockerOnline: boolean;
  alerts: string[];
  timestamp: string;
}

export type { ContainerAction, ComposeAction };
