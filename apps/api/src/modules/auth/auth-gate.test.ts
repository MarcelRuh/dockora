import { afterEach, describe, expect, it, vi } from 'vitest';

const getAuthEnabled = vi.fn();

vi.mock('../settings/settings.service.js', () => ({
  PrismaSettingsRepository: class {},
  SettingsService: class {
    getAuthEnabled = getAuthEnabled;
  },
}));

describe('isAuthEnabled cache race', () => {
  afterEach(() => {
    getAuthEnabled.mockReset();
    vi.resetModules();
  });

  it('does not restore a stale false after invalidate during read', async () => {
    getAuthEnabled.mockImplementation(async () => {
      const { invalidateAuthEnabledCache } = await import('./auth-gate.js');
      invalidateAuthEnabledCache();
      return false;
    });

    const { isAuthEnabled, invalidateAuthEnabledCache } = await import('./auth-gate.js');
    invalidateAuthEnabledCache();
    await expect(isAuthEnabled()).resolves.toBe(false);

    getAuthEnabled.mockResolvedValue(true);
    await expect(isAuthEnabled()).resolves.toBe(true);
  });
});
