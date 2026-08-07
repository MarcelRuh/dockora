/** Container-Status (Docker-kompatibel) */
export type ContainerStatus =
  | 'created'
  | 'running'
  | 'paused'
  | 'restarting'
  | 'removing'
  | 'exited'
  | 'dead'
  | 'unknown';

export type ContainerAction =
  | 'start'
  | 'stop'
  | 'restart'
  | 'kill'
  | 'pause'
  | 'unpause'
  | 'remove';

export type ComposeProjectStatus = 'running' | 'partial' | 'stopped' | 'unknown';

export type ComposeAction =
  | 'up'
  | 'down'
  | 'restart'
  | 'pull'
  | 'build'
  | 'recreate'
  | 'logs';

export type RegistryProvider =
  | 'dockerhub'
  | 'ghcr'
  | 'quay'
  | 'gitea'
  | 'gitlab'
  | 'private';

export type BackupFormat = 'zip' | 'tar' | 'tar.gz';
export type SchedulePreset = 'daily' | 'weekly' | 'monthly' | 'custom';
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type NotificationEvent =
  | 'container.started'
  | 'container.stopped'
  | 'container.crashed'
  | 'container.restarted'
  | 'update.available'
  | 'update.installed'
  | 'error'
  | 'backup.completed'
  | 'restore.completed'
  | 'system';

export type UserRole = 'admin' | 'operator' | 'viewer';

export type JobType =
  | 'update_check'
  | 'backup'
  | 'cleanup'
  | 'healthcheck'
  | 'image_pull'
  | 'monitoring';

export interface ApiErrorBody {
  statusCode: number;
  error: string;
  message: string;
  requestId?: string;
  details?: unknown;
}

export interface PaginatedMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: PaginatedMeta;
}

export interface ActionResult {
  ok: boolean;
  message: string;
}

/** Result of applying a container image update (pull + recreate + health). */
export interface UpdateApplyResult extends ActionResult {
  rolledBack?: boolean;
  step?: 'pull' | 'recreate' | 'health' | 'done' | 'rollback';
  prunedImages?: number;
  spaceReclaimed?: number;
}

/** Dry-run / preview payload before confirming a backup restore. */
export interface BackupRestorePreview {
  composeFiles: string[];
  envFiles: string[];
  hasSettings: boolean;
  volumes: string[];
}

export interface BackupRestoreResult extends ActionResult {
  extractedTo: string;
  appliedFiles: number;
  appliedSettings: boolean;
  appliedVolumes: number;
  backedUpFiles: string[];
  preview?: BackupRestorePreview;
}
