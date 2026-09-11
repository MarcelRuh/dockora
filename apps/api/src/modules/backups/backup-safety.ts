import path from 'node:path';
import { COMPOSE_FILENAMES } from '@dockora/shared';

const ENV_FILE_RE = /^\.env(?:\.[A-Za-z0-9._-]+)?$/;
const VOLUME_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,254}$/;

export class UnsafeBackupPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeBackupPathError';
  }
}

/** True if `entryName` extracts inside `destDir` (zip/tar slip guard). */
export function isSafeArchiveEntry(entryName: string, destDir: string): boolean {
  const trimmed = entryName.replace(/\\/g, '/').trim();
  if (!trimmed || trimmed.includes('\0')) return false;
  if (path.isAbsolute(trimmed) || trimmed.startsWith('/') || trimmed.startsWith('~')) {
    return false;
  }
  if (/^[a-zA-Z]:/.test(trimmed)) return false;

  const dest = path.resolve(destDir);
  const target = path.resolve(dest, trimmed);
  return target === dest || target.startsWith(`${dest}${path.sep}`);
}

export function assertSafeArchiveEntries(entryNames: string[], destDir: string): void {
  for (const name of entryNames) {
    if (!isSafeArchiveEntry(name, destDir)) {
      throw new UnsafeBackupPathError(`Unsafe archive entry: ${name}`);
    }
  }
}

function isUnderSearchPath(resolved: string, searchPaths: string[]): boolean {
  return searchPaths.some((sp) => {
    const base = path.resolve(sp);
    return resolved === base || resolved.startsWith(`${base}${path.sep}`);
  });
}

function isDockoraInstallPath(resolved: string): boolean {
  return resolved === '/opt/dockora' || resolved.startsWith(`/opt/dockora${path.sep}`);
}

/** Compose YAML restore: known compose filenames under configured search roots. */
export function isAllowedRestoreComposeTarget(target: string, searchPaths: string[]): boolean {
  if (!path.isAbsolute(target)) return false;
  const resolved = path.resolve(target);
  if (isDockoraInstallPath(resolved)) return false;
  if (!isUnderSearchPath(resolved, searchPaths)) return false;
  return (COMPOSE_FILENAMES as readonly string[]).includes(path.basename(resolved));
}

/** Env restore: `.env` / `.env.*` under configured search roots. */
export function isAllowedRestoreEnvTarget(target: string, searchPaths: string[]): boolean {
  if (!path.isAbsolute(target)) return false;
  const resolved = path.resolve(target);
  if (isDockoraInstallPath(resolved)) return false;
  if (!isUnderSearchPath(resolved, searchPaths)) return false;
  return ENV_FILE_RE.test(path.basename(resolved));
}

export function isAllowedRestoreFileTarget(
  kind: 'compose' | 'env',
  target: string,
  searchPaths: string[],
): boolean {
  return kind === 'compose'
    ? isAllowedRestoreComposeTarget(target, searchPaths)
    : isAllowedRestoreEnvTarget(target, searchPaths);
}

/** Docker named volume — no paths, no traversal. */
export function isSafeVolumeName(name: string): boolean {
  if (!name || name.includes('/') || name.includes('\\') || name.includes('..')) {
    return false;
  }
  return VOLUME_NAME_RE.test(name);
}
