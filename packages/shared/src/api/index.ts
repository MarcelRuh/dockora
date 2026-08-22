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

export interface DashboardUnhealthyContainer {
  id: string;
  name: string;
  composeProject?: string;
}

export interface DashboardOverview {
  containers: {
    total: number;
    running: number;
    stopped: number;
    unhealthy: number;
  };
  unhealthyContainers: DashboardUnhealthyContainer[];
  resources: {
    cpuPercent: number | null;
    cpuCores: number | null;
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
  /** Present when list is requested with includeStats (running containers only). */
  cpuPercent?: number | null;
  memoryPercent?: number | null;
  memoryUsageBytes?: number | null;
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
  /** When true, include Dockora's own containers (for monitoring topology). */
  includeSelf?: boolean | string;
  /** When true, attach cpu/memory stats for running containers. */
  includeStats?: boolean | string;
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

export interface ComposeImageChange {
  service: string;
  currentImage: string | null;
  desiredImage: string | null;
}

export interface ComposeChangePreview {
  projectId: string;
  projectName: string;
  servicesAdded: string[];
  servicesRemoved: string[];
  imageChanges: ComposeImageChange[];
  envChangedServices: string[];
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
  /** Last run error message (cleared on success). */
  lastError?: string;
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
  /** GitHub Container Registry PAT (ghcr.io) */
  ghcrToken: string;
  /** LinuxServer / lscr.io Token (optional; falls leer wird ghcrToken genutzt) */
  lscrToken: string;
  backupRetentionDays: number;
  backupFormat: BackupFormat;
  backupSchedule: SchedulePreset | 'off';
  monitoringCpuThreshold: number;
  monitoringRamThreshold: number;
  monitoringDiskThreshold: number;
  /** Alert when Docker build cache exceeds this many GB */
  monitoringBuildCacheGbThreshold: number;
  /** Alert when host CPU package temperature reaches this °C */
  monitoringTempThreshold: number;
  authEnabled: boolean;
}

export interface AuthUser {
  id: string;
  email: string;
  displayName: string | null;
  role: UserRole;
  totpEnabled: boolean;
}

export interface AuthStatusResponse {
  authEnabled: boolean;
}

export interface AuthLoginResponse {
  /** Present when login completed (no 2FA or after TOTP). */
  token?: string;
  user?: AuthUser;
  /** Password ok, TOTP required. */
  requiresTotp?: boolean;
  /** Short-lived token for POST /auth/login/totp */
  tempToken?: string;
}

export interface AuthTotpSetupResponse {
  secret: string;
  otpauthUrl: string;
  qrDataUrl: string;
}

export interface AuthTotpConfirmResponse {
  backupCodes: string[];
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
    /** Docker BuildKit cache size in bytes (null if unknown). */
    buildCacheBytes: number | null;
    temperatureC: number | null;
  };
  dockerOnline: boolean;
  alerts: string[];
  timestamp: string;
}

export type { ContainerAction, ComposeAction };
