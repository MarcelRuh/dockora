import type {
  ActionResult,
  AppSettings,
  AuthLoginResponse,
  AuthStatusResponse,
  AuthUser,
  BackupFormat,
  BackupInfo,
  BackupRestoreResult,
  ComposeAction,
  ComposeProjectDetails,
  ComposeProjectSummary,
  ContainerAction,
  ContainerDetails,
  ContainerFilter,
  ContainerStatsSnapshot,
  ContainerSummary,
  DashboardNotification,
  DashboardOverview,
  HealthResponse,
  ImageSummary,
  VolumeBrowseEntry,
  VolumeSummary,
  LogEntry,
  LogLevel,
  MonitoringSnapshot,
  ScheduledJob,
  UpdateApplyResult,
  UpdateCheckResult,
} from '@dockora/shared';
import { clearSessionToken, csrfHeaders, getSessionToken, setSessionToken as setSessionTokenFromLogin } from './auth';

const API_BASE = '/api/v1';

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const method = (init?.method ?? 'GET').toUpperCase();
  const token = getSessionToken();
  const headers: Record<string, string> = {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(method !== 'GET' && method !== 'HEAD' ? (csrfHeaders() as Record<string, string>) : {}),
    ...(init?.headers as Record<string, string> | undefined),
  };

  if (init?.body && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(`${API_BASE}${path}`, {
    cache: 'no-store',
    credentials: 'include',
    ...init,
    headers,
  });

  if (!res.ok) {
    if (res.status === 401 && path !== '/auth/login' && path !== '/auth/login/totp' && path !== '/auth/status') {
      clearSessionToken();
    }
    let message = `API ${path} failed: ${res.status}`;
    try {
      const body = (await res.json()) as { message?: string };
      if (body.message) message = body.message;
    } catch {
      // ignore
    }
    throw new ApiError(message, res.status);
  }

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    // Fastify sends bare strings as-is (e.g. compose `config` YAML, log dumps).
    // Treat non-JSON success bodies as plain text rather than failing the UI.
    return text as T;
  }
}

function qs(params: Record<string, string | number | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

// Health & Dashboard
export async function fetchHealth(): Promise<HealthResponse> {
  return request<HealthResponse>('/health');
}

export async function fetchDashboard(): Promise<DashboardOverview> {
  return request<DashboardOverview>('/dashboard');
}

// Containers
export async function fetchContainers(filter?: ContainerFilter): Promise<ContainerSummary[]> {
  return request<ContainerSummary[]>(
    `/containers${qs({
      name: filter?.name,
      status: filter?.status === 'all' ? undefined : filter?.status,
      image: filter?.image,
      label: filter?.label,
      network: filter?.network,
      includeSelf:
        filter?.includeSelf === true ||
        filter?.includeSelf === 'true' ||
        filter?.includeSelf === '1'
          ? 'true'
          : undefined,
      includeStats:
        filter?.includeStats === true ||
        filter?.includeStats === 'true' ||
        filter?.includeStats === '1'
          ? 'true'
          : undefined,
    })}`,
  );
}

export async function fetchContainer(id: string): Promise<ContainerDetails> {
  return request<ContainerDetails>(`/containers/${encodeURIComponent(id)}`);
}

export async function fetchContainerStats(id: string): Promise<ContainerStatsSnapshot> {
  return request<ContainerStatsSnapshot>(`/containers/${encodeURIComponent(id)}/stats`);
}

export async function fetchContainerLogs(id: string, tail = 200): Promise<string> {
  const res = await request<string | { logs: string }>(
    `/containers/${encodeURIComponent(id)}/logs${qs({ tail })}`,
  );
  return typeof res === 'string' ? res : res.logs;
}

export async function containerAction(
  id: string,
  action: ContainerAction,
  body?: { force?: boolean; deleteProjectDir?: boolean },
): Promise<ActionResult> {
  return request<ActionResult>(`/containers/${encodeURIComponent(id)}/${action}`, {
    method: 'POST',
    body: JSON.stringify(body ?? {}),
  });
}

// Compose
export async function fetchComposeProjects(): Promise<ComposeProjectSummary[]> {
  return request<ComposeProjectSummary[]>('/compose');
}

export async function fetchComposeProject(id: string): Promise<ComposeProjectDetails> {
  return request<ComposeProjectDetails>(`/compose/${encodeURIComponent(id)}`);
}

export async function composeAction(
  id: string,
  action: ComposeAction,
  service?: string,
): Promise<ActionResult> {
  return request<ActionResult>(
    `/compose/${encodeURIComponent(id)}/${action}${qs({ service })}`,
    { method: 'POST' },
  );
}

export async function saveComposeYaml(id: string, content: string): Promise<ComposeProjectDetails> {
  return request<ComposeProjectDetails>(`/compose/${encodeURIComponent(id)}/yaml`, {
    method: 'PUT',
    body: JSON.stringify({ content }),
  });
}

export async function fetchComposeEnv(
  id: string,
  fileName = '.env',
): Promise<{ fileName: string; content: string; exists: boolean }> {
  const q = fileName !== '.env' ? `?file=${encodeURIComponent(fileName)}` : '';
  return request(`/compose/${encodeURIComponent(id)}/env${q}`);
}

export async function saveComposeEnv(
  id: string,
  content: string,
  fileName = '.env',
): Promise<ComposeProjectDetails> {
  return request<ComposeProjectDetails>(`/compose/${encodeURIComponent(id)}/env`, {
    method: 'PUT',
    body: JSON.stringify({ content, fileName }),
  });
}

export async function validateComposeConfig(id: string): Promise<string> {
  const res = await request<string | { config: string }>(
    `/compose/${encodeURIComponent(id)}/config`,
  );
  return typeof res === 'string' ? res : res.config;
}

export async function previewComposeChanges(id: string): Promise<import('@dockora/shared').ComposeChangePreview> {
  return request(`/compose/${encodeURIComponent(id)}/preview`);
}

export async function fetchComposeLogs(id: string, service?: string): Promise<string> {
  const res = await request<string | { logs: string }>(
    `/compose/${encodeURIComponent(id)}/logs${qs({ service })}`,
  );
  return typeof res === 'string' ? res : res.logs;
}

export async function backupComposeProject(id: string): Promise<BackupInfo> {
  return request<BackupInfo>(`/compose/${encodeURIComponent(id)}/backup`, { method: 'POST' });
}

export async function fetchComposeBases(): Promise<Array<{ path: string; writable: boolean }>> {
  const res = await request<{ bases: Array<string | { path: string; writable: boolean }> }>(
    '/compose/bases',
  );
  return res.bases.map((b) =>
    typeof b === 'string' ? { path: b, writable: true } : { path: b.path, writable: b.writable },
  );
}

export async function createComposeProject(input: {
  name: string;
  basePath: string;
  composeFileName?: string;
  yaml: string;
  envContent?: string;
  start?: boolean;
}): Promise<ComposeProjectDetails> {
  return request<ComposeProjectDetails>('/compose', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function deleteComposeProject(
  id: string,
  options?: { removeFiles?: boolean; removeVolumes?: boolean },
): Promise<ActionResult> {
  const params = new URLSearchParams();
  if (options?.removeFiles === false) params.set('removeFiles', 'false');
  if (options?.removeVolumes === true) params.set('removeVolumes', 'true');
  const qs = params.toString();
  return request<ActionResult>(
    `/compose/${encodeURIComponent(id)}${qs ? `?${qs}` : ''}`,
    { method: 'DELETE' },
  );
}

// Images
export async function fetchImages(): Promise<ImageSummary[]> {
  return request<ImageSummary[]>('/images');
}

export async function pullImage(image: string): Promise<ActionResult> {
  return request<ActionResult>('/images/pull', {
    method: 'POST',
    body: JSON.stringify({ image }),
  });
}

export async function pruneImages(danglingOnly = true): Promise<
  ActionResult & { imagesDeleted: number; spaceReclaimed: number }
> {
  return request<ActionResult & { imagesDeleted: number; spaceReclaimed: number }>(
    '/images/prune',
    {
      method: 'POST',
      body: JSON.stringify({ danglingOnly }),
    },
  );
}

export async function removeImage(id: string, force = false): Promise<ActionResult> {
  return request<ActionResult>(
    `/images/${encodeURIComponent(id)}${qs({ force: force ? 'true' : undefined })}`,
    { method: 'DELETE' },
  );
}

export async function fetchVolumes(): Promise<VolumeSummary[]> {
  return request<VolumeSummary[]>('/volumes');
}

export async function pruneVolumes(): Promise<
  ActionResult & { volumesDeleted: number; spaceReclaimed: number }
> {
  return request<ActionResult & { volumesDeleted: number; spaceReclaimed: number }>(
    '/volumes/prune',
    { method: 'POST' },
  );
}

export async function removeVolume(name: string): Promise<ActionResult> {
  return request<ActionResult>(`/volumes/${encodeURIComponent(name)}`, { method: 'DELETE' });
}

export async function browseVolume(name: string): Promise<VolumeBrowseEntry[]> {
  return request<VolumeBrowseEntry[]>(`/volumes/${encodeURIComponent(name)}/browse`);
}

// Updates
export async function fetchUpdates(): Promise<UpdateCheckResult[]> {
  return request<UpdateCheckResult[]>('/updates');
}

export async function checkUpdates(): Promise<UpdateCheckResult[]> {
  return request<UpdateCheckResult[]>('/updates/check', { method: 'POST' });
}

export async function pullUpdate(containerId: string): Promise<UpdateApplyResult> {
  return request<UpdateApplyResult>(
    `/updates/${encodeURIComponent(containerId)}/pull`,
    { method: 'POST' },
  );
}

export async function fetchSelfUpdateStatus(): Promise<{
  enabled: boolean;
  mode: 'compose' | 'image' | 'none';
  currentVersion: string;
  sourceVersion: string | null;
  remoteVersion: string | null;
  localRevision: string | null;
  remoteRevision: string | null;
  image: string | null;
  currentDigest: string | null;
  remoteDigest: string | null;
  updateAvailable: boolean;
  message: string;
  installDir: string | null;
  repo: string | null;
  branch: string | null;
  updating: boolean;
  progress: { percent: number; step: string; detail: string | null } | null;
  changelog: string | null;
  targetVersion: string | null;
}> {
  return request('/system/self-update');
}

export async function applySelfUpdate(): Promise<{
  ok: boolean;
  message: string;
  mode: 'compose' | 'image' | 'none';
}> {
  return request('/system/self-update', { method: 'POST' });
}

export async function fetchDockerHostUpdateStatus(): Promise<{
  updating: boolean;
  target: 'engine' | 'compose' | null;
  percent: number;
  step: string;
  detail: string | null;
  message: string | null;
  ok: boolean | null;
}> {
  return request('/system/docker-update');
}

export async function applyDockerHostUpdate(
  target: 'engine' | 'compose',
): Promise<ActionResult> {
  return request('/system/docker-update', {
    method: 'POST',
    body: JSON.stringify({ target }),
  });
}

export type PluginInfo = {
  name: string;
  version: string | null;
  enabled: boolean;
  loaded: boolean;
  dirName: string;
};

export async function fetchPlugins(): Promise<{
  plugins: PluginInfo[];
  pluginDir: string;
}> {
  return request('/plugins');
}

export async function enablePlugin(name: string): Promise<{
  plugins: PluginInfo[];
  pluginDir: string;
}> {
  return request(`/plugins/${encodeURIComponent(name)}/enable`, { method: 'POST' });
}

export async function disablePlugin(name: string): Promise<{
  plugins: PluginInfo[];
  pluginDir: string;
}> {
  return request(`/plugins/${encodeURIComponent(name)}/disable`, { method: 'POST' });
}

// Backups
export async function fetchBackups(): Promise<BackupInfo[]> {
  return request<BackupInfo[]>('/backups');
}

export async function createBackup(options?: {
  format?: BackupFormat;
  includeVolumes?: boolean;
}): Promise<BackupInfo> {
  return request<BackupInfo>('/backups', {
    method: 'POST',
    body: JSON.stringify(options ?? {}),
  });
}

export async function restoreBackup(
  id: string,
  options: {
    confirm?: boolean;
    applyFiles?: boolean;
    applySettings?: boolean;
    applyVolumes?: boolean;
  } = {},
): Promise<BackupRestoreResult> {
  return request<BackupRestoreResult>(`/backups/${encodeURIComponent(id)}/restore`, {
    method: 'POST',
    body: JSON.stringify(options),
  });
}

export async function deleteBackup(id: string): Promise<void> {
  return request<void>(`/backups/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function cleanupBackups(): Promise<{ deleted: number }> {
  return request<{ deleted: number }>('/backups/cleanup', { method: 'POST' });
}

// Logs
export async function fetchLogs(params?: {
  container?: string;
  level?: LogLevel;
  q?: string;
  limit?: number;
  since?: string;
}): Promise<LogEntry[]> {
  return request<LogEntry[]>(
    `/logs${qs({
      container: params?.container,
      level: params?.level,
      q: params?.q,
      limit: params?.limit,
      since: params?.since,
    })}`,
  );
}

// Settings
export async function fetchSettings(): Promise<AppSettings> {
  return request<AppSettings>('/settings');
}

export async function updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  return request<AppSettings>('/settings', {
    method: 'PUT',
    body: JSON.stringify(patch),
  });
}

// Notifications
export async function fetchNotifications(): Promise<DashboardNotification[]> {
  return request<DashboardNotification[]>('/notifications');
}

export async function markNotificationRead(id: string): Promise<void> {
  return request<void>(`/notifications/${encodeURIComponent(id)}/read`, { method: 'POST' });
}

export async function markAllNotificationsRead(): Promise<void> {
  return request<void>('/notifications/read-all', { method: 'POST' });
}

export async function testDiscordNotification(): Promise<{ ok: boolean; message: string }> {
  return request('/notifications/test', { method: 'POST' });
}

// Monitoring
export async function fetchMonitoring(): Promise<MonitoringSnapshot> {
  return request<MonitoringSnapshot>('/monitoring');
}

// Scheduler
export async function fetchSchedulerJobs(): Promise<ScheduledJob[]> {
  return request<ScheduledJob[]>('/scheduler/jobs');
}

export async function updateSchedulerJob(
  id: string,
  patch: { enabled?: boolean; cron?: string },
): Promise<ScheduledJob> {
  return request<ScheduledJob>(`/scheduler/jobs/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export async function runSchedulerJob(id: string): Promise<{ ok: boolean; message: string }> {
  return request(`/scheduler/jobs/${encodeURIComponent(id)}/run`, { method: 'POST' });
}

// Auth
export async function fetchAuthStatus(): Promise<AuthStatusResponse> {
  return request<AuthStatusResponse>('/auth/status');
}

export async function login(email: string, password: string): Promise<AuthLoginResponse> {
  const result = await request<AuthLoginResponse>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  if (result.token) setSessionTokenFromLogin(result.token);
  return result;
}

export async function loginTotp(tempToken: string, code: string): Promise<AuthLoginResponse> {
  const result = await request<AuthLoginResponse>('/auth/login/totp', {
    method: 'POST',
    body: JSON.stringify({ tempToken, code }),
  });
  if (result.token) setSessionTokenFromLogin(result.token);
  return result;
}

export async function logout(): Promise<void> {
  try {
    await request('/auth/logout', { method: 'POST' });
  } finally {
    clearSessionToken();
  }
}

export async function setupTotp(): Promise<import('@dockora/shared').AuthTotpSetupResponse> {
  return request('/auth/totp/setup', { method: 'POST' });
}

export async function confirmTotp(
  code: string,
): Promise<import('@dockora/shared').AuthTotpConfirmResponse> {
  return request('/auth/totp/confirm', {
    method: 'POST',
    body: JSON.stringify({ code }),
  });
}

export async function disableTotp(password: string, code?: string): Promise<AuthUser> {
  return request<AuthUser>('/auth/totp/disable', {
    method: 'POST',
    body: JSON.stringify({ password, code }),
  });
}

export async function fetchCurrentUser(): Promise<AuthUser> {
  return request<AuthUser>('/auth/me');
}

export async function fetchAuthUsers(): Promise<AuthUser[]> {
  return request<AuthUser[]>('/auth/users');
}

export async function createAuthUser(body: {
  email: string;
  password: string;
  displayName?: string;
  role?: AuthUser['role'];
}): Promise<AuthUser> {
  return request<AuthUser>('/auth/users', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function updateAuthUser(
  id: string,
  body: { role?: AuthUser['role']; displayName?: string | null; password?: string },
): Promise<AuthUser> {
  return request<AuthUser>(`/auth/users/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

export async function deleteAuthUser(id: string): Promise<void> {
  return request<void>(`/auth/users/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function fetchAuditLogs(params?: {
  limit?: number;
  action?: string;
  actorId?: string;
  resource?: string;
  since?: string;
  until?: string;
}): Promise<
  Array<{
    id: string;
    action: string;
    actorId: string | null;
    resource: string | null;
    resourceId: string | null;
    metadata: Record<string, unknown> | null;
    createdAt: string;
  }>
> {
  const qs = new URLSearchParams();
  if (params?.limit) qs.set('limit', String(params.limit));
  if (params?.action) qs.set('action', params.action);
  if (params?.actorId) qs.set('actorId', params.actorId);
  if (params?.resource) qs.set('resource', params.resource);
  if (params?.since) qs.set('since', params.since);
  if (params?.until) qs.set('until', params.until);
  const suffix = qs.toString() ? `?${qs}` : '';
  return request(`/audit${suffix}`);
}
