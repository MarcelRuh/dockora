import { describe, expect, it } from 'vitest';
import { isWeakBootstrapPassword, isWeakJwtSecret, loadConfig } from './env.js';

describe('loadConfig', () => {
  it('parses valid environment variables', () => {
    const config = loadConfig({
      NODE_ENV: 'test',
      HOST: '127.0.0.1',
      PORT: '4000',
      LOG_LEVEL: 'warn',
      DATABASE_URL: 'file:./test.db',
      DOCKER_SOCKET: '/var/run/docker.sock',
      CORS_ORIGIN: 'http://localhost:3000',
      JWT_SECRET: 'test-secret-at-least-16',
      JWT_EXPIRES_IN: '1h',
      RATE_LIMIT_MAX: '50',
      RATE_LIMIT_TIME_WINDOW_MS: '30000',
      COMPOSE_SEARCH_PATHS: '/opt,/srv',
      COMPOSE_EXCLUDE_PATHS: '/opt/hidden',
      AUTO_UPDATE_ENABLED: 'false',
    });

    expect(config.port).toBe(4000);
    expect(config.composeSearchPaths).toEqual(['/opt', '/srv']);
    expect(config.composeExcludePaths).toContain('/opt/hidden');
    expect(config.autoUpdateEnabled).toBe(false);
    expect(config.backupDir).toContain('backups');
  });

  it('respects BACKUP_DIR override', () => {
    const config = loadConfig({
      DATABASE_URL: 'file:./test.db',
      JWT_SECRET: 'test-secret-at-least-16',
      BACKUP_DIR: '/tmp/dockora-backups-test',
    });
    expect(config.backupDir).toBe('/tmp/dockora-backups-test');
  });

  it('throws on missing JWT_SECRET', () => {
    expect(() =>
      loadConfig({
        DATABASE_URL: 'file:./test.db',
        JWT_SECRET: 'short',
      }),
    ).toThrow(/Invalid environment/);
  });

  it('rejects weak JWT_SECRET in production', () => {
    expect(() =>
      loadConfig({
        NODE_ENV: 'production',
        DATABASE_URL: 'file:./test.db',
        JWT_SECRET: 'change-me-in-production-use-long-random-string',
        BOOTSTRAP_ADMIN_PASSWORD: 'a-strong-prod-password',
      }),
    ).toThrow(/weak JWT_SECRET/);
  });

  it('rejects short JWT_SECRET in production', () => {
    expect(() =>
      loadConfig({
        NODE_ENV: 'production',
        DATABASE_URL: 'file:./test.db',
        JWT_SECRET: 'only-twenty-chars-ok!',
        BOOTSTRAP_ADMIN_PASSWORD: 'a-strong-prod-password',
      }),
    ).toThrow(/at least 32/);
  });

  it('rejects weak bootstrap password in production', () => {
    expect(() =>
      loadConfig({
        NODE_ENV: 'production',
        DATABASE_URL: 'file:./test.db',
        JWT_SECRET: 'prod-secret-with-enough-entropy-abc123XYZ',
        BOOTSTRAP_ADMIN_PASSWORD: 'dockora-admin-change-me',
      }),
    ).toThrow(/BOOTSTRAP_ADMIN_PASSWORD/);
  });

  it('accepts strong production secrets', () => {
    const config = loadConfig({
      NODE_ENV: 'production',
      DATABASE_URL: 'file:./test.db',
      JWT_SECRET: 'prod-secret-with-enough-entropy-abc123XYZ',
      BOOTSTRAP_ADMIN_PASSWORD: 'a-strong-prod-password',
    });
    expect(config.nodeEnv).toBe('production');
    expect(config.bootstrapAdminPassword).toBe('a-strong-prod-password');
  });
});

describe('secret heuristics', () => {
  it('flags weak jwt secrets', () => {
    expect(isWeakJwtSecret('change-me-in-production-use-long-random-string')).toBe(true);
    expect(isWeakJwtSecret('prod-secret-with-enough-entropy-abc123XYZ')).toBe(false);
  });

  it('flags weak bootstrap passwords', () => {
    expect(isWeakBootstrapPassword('dockora-admin-change-me')).toBe(true);
    expect(isWeakBootstrapPassword('short')).toBe(true);
    expect(isWeakBootstrapPassword('a-strong-prod-password')).toBe(false);
  });
});
