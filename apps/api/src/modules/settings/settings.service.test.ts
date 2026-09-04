import { describe, expect, it } from 'vitest';
import { clampDays, DEFAULT_SETTINGS, SettingsService } from './settings.service.js';
import { retentionCutoff } from './data-retention.js';

describe('DEFAULT_SETTINGS', () => {
  it('enables auth so fresh installs show the login screen', () => {
    expect(DEFAULT_SETTINGS.authEnabled).toBe(true);
  });

  it('retains notifications and audit logs by default', () => {
    expect(DEFAULT_SETTINGS.notificationRetentionDays).toBe(30);
    expect(DEFAULT_SETTINGS.auditRetentionDays).toBe(90);
  });
});

describe('SettingsService.getAuthEnabled', () => {
  it('reads only the authEnabled key', async () => {
    const repo = {
      get: async (key: string) => (key === 'authEnabled' ? 'false' : null),
      set: async () => undefined,
      getAll: async () => {
        throw new Error('should not load all settings');
      },
    };
    const service = new SettingsService(repo);
    await expect(service.getAuthEnabled()).resolves.toBe(false);
  });
});

describe('clampDays', () => {
  it('clamps to 1–3650', () => {
    expect(clampDays(0, 14)).toBe(1);
    expect(clampDays(9000, 14)).toBe(3650);
    expect(clampDays(Number.NaN, 14)).toBe(14);
  });
});

describe('retentionCutoff', () => {
  it('subtracts whole days', () => {
    const now = new Date('2026-09-04T12:00:00.000Z');
    expect(retentionCutoff(30, now).toISOString()).toBe('2026-08-05T12:00:00.000Z');
  });
});
