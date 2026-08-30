import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, SettingsService } from './settings.service.js';

describe('DEFAULT_SETTINGS', () => {
  it('enables auth so fresh installs show the login screen', () => {
    expect(DEFAULT_SETTINGS.authEnabled).toBe(true);
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
