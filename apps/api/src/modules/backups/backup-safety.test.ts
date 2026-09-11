import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assertSafeArchiveEntries,
  isAllowedRestoreFileTarget,
  isSafeArchiveEntry,
  isSafeVolumeName,
  UnsafeBackupPathError,
} from './backup-safety.js';

describe('isSafeArchiveEntry', () => {
  const dest = '/tmp/dockora-restore';

  it('allows nested files inside the extract dir', () => {
    expect(isSafeArchiveEntry('manifest.json', dest)).toBe(true);
    expect(isSafeArchiveEntry('files/0001/compose.yml', dest)).toBe(true);
    expect(isSafeArchiveEntry('files/0001/', dest)).toBe(true);
  });

  it('rejects zip/tar slip and absolute paths', () => {
    expect(isSafeArchiveEntry('../evil.txt', dest)).toBe(false);
    expect(isSafeArchiveEntry('files/../../etc/passwd', dest)).toBe(false);
    expect(isSafeArchiveEntry('/etc/passwd', dest)).toBe(false);
    expect(isSafeArchiveEntry('C:/Windows/system.ini', dest)).toBe(false);
    expect(isSafeArchiveEntry('..\\evil.txt', dest)).toBe(false);
  });

  it('throws when listing contains a slip entry', () => {
    expect(() => assertSafeArchiveEntries(['ok.txt', '../x'], dest)).toThrow(UnsafeBackupPathError);
  });
});

describe('isAllowedRestoreFileTarget', () => {
  const search = ['/home', '/opt', '/srv', '/data/compose'];

  it('allows compose and env files under search paths', () => {
    expect(isAllowedRestoreFileTarget('compose', '/home/plex/compose.yml', search)).toBe(true);
    expect(isAllowedRestoreFileTarget('compose', '/opt/arr/docker-compose.yaml', search)).toBe(true);
    expect(isAllowedRestoreFileTarget('env', '/srv/stack/.env', search)).toBe(true);
    expect(isAllowedRestoreFileTarget('env', '/data/compose/app/.env.prod', search)).toBe(true);
  });

  it('rejects paths outside search roots and the Dockora install tree', () => {
    expect(isAllowedRestoreFileTarget('compose', '/etc/compose.yml', search)).toBe(false);
    expect(isAllowedRestoreFileTarget('env', '/root/.env', search)).toBe(false);
    expect(isAllowedRestoreFileTarget('compose', '/opt/dockora/compose.yml', search)).toBe(false);
    expect(isAllowedRestoreFileTarget('compose', 'relative/compose.yml', search)).toBe(false);
  });

  it('rejects non-compose / non-env basenames even under search paths', () => {
    expect(isAllowedRestoreFileTarget('compose', '/home/user/.ssh/id_rsa', search)).toBe(false);
    expect(isAllowedRestoreFileTarget('env', '/home/user/secrets.txt', search)).toBe(false);
  });
});

describe('isSafeVolumeName', () => {
  it('accepts docker volume names', () => {
    expect(isSafeVolumeName('plex_config')).toBe(true);
    expect(isSafeVolumeName('stack.db-1')).toBe(true);
  });

  it('rejects paths and traversal', () => {
    expect(isSafeVolumeName('../etc')).toBe(false);
    expect(isSafeVolumeName('/var/lib/docker/volumes/x')).toBe(false);
    expect(isSafeVolumeName('a/b')).toBe(false);
    expect(isSafeVolumeName('')).toBe(false);
  });
});

describe('path join still cannot escape dest', () => {
  it('resolves archivePath against extract dir', () => {
    const extract = '/tmp/extract';
    const sneaky = path.join(extract, 'files/../../etc/passwd');
    expect(path.resolve(sneaky).startsWith(path.resolve(extract) + path.sep)).toBe(false);
  });
});
