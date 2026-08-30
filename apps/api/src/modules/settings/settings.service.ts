import type { AppSettings, NotificationEvent, BackupFormat } from '@dockora/shared';
import type { ISettingsRepository } from '../../domain/ports.js';
import { prisma } from '../../infrastructure/db/prisma.js';

const DEFAULTS: AppSettings = {
  dockerSocket: '/var/run/docker.sock',
  composeSearchPaths: ['/home', '/opt', '/srv', '/data/compose'],
  discordWebhookUrl: '',
  discordEnabled: false,
  discordEvents: [
    'container.crashed',
    'update.available',
    'error',
    'backup.completed',
  ],
  locale: 'de',
  timezone: 'Europe/Berlin',
  updateCheckIntervalMinutes: 120,
  autoUpdateImages: false,
  ghcrToken: '',
  lscrToken: '',
  backupRetentionDays: 14,
  backupFormat: 'tar.gz',
  backupSchedule: 'daily',
  monitoringCpuThreshold: 90,
  monitoringRamThreshold: 90,
  monitoringDiskThreshold: 85,
  monitoringBuildCacheGbThreshold: 5,
  monitoringTempThreshold: 95,
  /** Fresh GitHub/Compose installs must show the login screen. */
  authEnabled: true,
};

export class PrismaSettingsRepository implements ISettingsRepository {
  async get(key: string): Promise<string | null> {
    const row = await prisma.setting.findUnique({ where: { key } });
    return row?.value ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    await prisma.setting.upsert({
      where: { key },
      create: { key, value },
      update: { value },
    });
  }

  async getAll(): Promise<Record<string, string>> {
    const rows = await prisma.setting.findMany();
    return Object.fromEntries(
      rows.map((row: { key: string; value: string }) => [row.key, row.value]),
    );
  }
}

export class SettingsService {
  constructor(private readonly repo: ISettingsRepository) {}

  async getAuthEnabled(): Promise<boolean> {
    const stored = await this.repo.get('authEnabled');
    if (stored == null || stored === '') return DEFAULTS.authEnabled;
    return stored === 'true';
  }

  async getSettings(envDefaults?: Partial<AppSettings>): Promise<AppSettings> {
    const stored = await this.repo.getAll();
    const base: AppSettings = {
      ...DEFAULTS,
      ...envDefaults,
    };

    return {
      dockerSocket: stored.dockerSocket ?? base.dockerSocket,
      composeSearchPaths: stored.composeSearchPaths
        ? safeJson(stored.composeSearchPaths, base.composeSearchPaths)
        : base.composeSearchPaths,
      discordWebhookUrl: stored.discordWebhookUrl ?? base.discordWebhookUrl,
      discordEnabled: stored.discordEnabled
        ? stored.discordEnabled === 'true'
        : base.discordEnabled,
      discordEvents: stored.discordEvents
        ? safeJson<NotificationEvent[]>(stored.discordEvents, base.discordEvents)
        : base.discordEvents,
      locale: (stored.locale as AppSettings['locale']) ?? base.locale,
      timezone: stored.timezone ?? base.timezone,
      updateCheckIntervalMinutes: num(
        stored.updateCheckIntervalMinutes,
        base.updateCheckIntervalMinutes,
      ),
      autoUpdateImages: stored.autoUpdateImages
        ? stored.autoUpdateImages === 'true'
        : base.autoUpdateImages,
      ghcrToken: stored.ghcrToken ?? base.ghcrToken,
      lscrToken: stored.lscrToken ?? base.lscrToken,
      backupRetentionDays: num(stored.backupRetentionDays, base.backupRetentionDays),
      backupFormat: (stored.backupFormat as BackupFormat) ?? base.backupFormat,
      backupSchedule: (stored.backupSchedule as AppSettings['backupSchedule']) ?? base.backupSchedule,
      monitoringCpuThreshold: num(stored.monitoringCpuThreshold, base.monitoringCpuThreshold),
      monitoringRamThreshold: num(stored.monitoringRamThreshold, base.monitoringRamThreshold),
      monitoringDiskThreshold: num(stored.monitoringDiskThreshold, base.monitoringDiskThreshold),
      monitoringBuildCacheGbThreshold: num(
        stored.monitoringBuildCacheGbThreshold,
        base.monitoringBuildCacheGbThreshold,
      ),
      monitoringTempThreshold: num(stored.monitoringTempThreshold, base.monitoringTempThreshold),
      authEnabled: stored.authEnabled ? stored.authEnabled === 'true' : base.authEnabled,
    };
  }

  async updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
    const entries: Array<[string, string]> = [];
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) continue;
      entries.push([
        key,
        typeof value === 'string' ? value : JSON.stringify(value),
      ]);
    }
    // booleans as 'true'/'false'
    for (const boolKey of ['discordEnabled', 'autoUpdateImages', 'authEnabled'] as const) {
      if (boolKey in patch && typeof patch[boolKey] === 'boolean') {
        const idx = entries.findIndex(([k]) => k === boolKey);
        if (idx >= 0) entries[idx] = [boolKey, String(patch[boolKey])];
      }
    }

    await Promise.all(entries.map(([k, v]) => this.repo.set(k, v)));
    return this.getSettings();
  }
}

function safeJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function num(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

/** Persist default login-on if the operator never saved the toggle. */
export async function ensureAuthEnabledStored(): Promise<void> {
  const repo = new PrismaSettingsRepository();
  const stored = await repo.get('authEnabled');
  if (stored == null || stored === '') {
    await repo.set('authEnabled', 'true');
  }
}

export { DEFAULTS as DEFAULT_SETTINGS };
