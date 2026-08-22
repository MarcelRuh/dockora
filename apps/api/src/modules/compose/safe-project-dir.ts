import path from 'node:path';
import { access, rm } from 'node:fs/promises';

export class UnsafeProjectPathError extends Error {
  readonly statusCode = 400;
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeProjectPathError';
  }
}

/**
 * Verhindert Löschen von Root-/Suchpfaden selbst – nur Projekt-Unterordner.
 */
export function assertSafeProjectDir(projectPath: string, searchPaths: string[]): void {
  const resolved = path.resolve(projectPath);
  const forbidden = new Set([
    '/',
    '/opt',
    '/srv',
    '/home',
    '/var',
    '/usr',
    '/etc',
    '/root',
    '/data',
    ...searchPaths.map((p) => path.resolve(p)),
  ]);

  if (forbidden.has(resolved) || resolved === path.parse(resolved).root) {
    throw new UnsafeProjectPathError(
      `Refusing to delete protected path: ${resolved}. Delete only project subdirectories.`,
    );
  }

  const underSearch = searchPaths.some((sp) => {
    const base = path.resolve(sp);
    return resolved === base || resolved.startsWith(base + path.sep);
  });
  // Allow under search paths OR under common compose roots even if not listed
  // (labels may point at /home/... while search paths are configured)
  if (!underSearch) {
    throw new UnsafeProjectPathError(`Project path is outside search paths: ${resolved}`);
  }

  // Extra guard: never delete Dockora's own install tree
  if (resolved === '/opt/dockora' || resolved.startsWith(`/opt/dockora${path.sep}`)) {
    throw new UnsafeProjectPathError(`Refusing to delete Dockora install path: ${resolved}`);
  }
}

/**
 * Löscht einen Compose-Projektordner rekursiv (nach Safety-Checks).
 */
export async function deleteProjectDirectory(
  projectPath: string,
  searchPaths: string[],
): Promise<void> {
  assertSafeProjectDir(projectPath, searchPaths);
  await rm(projectPath, { recursive: true, force: true });
  try {
    await access(projectPath);
    throw new UnsafeProjectPathError(
      `Project directory still exists after delete: ${projectPath}`,
    );
  } catch (error) {
    if (error instanceof UnsafeProjectPathError) throw error;
    // ENOENT expected
  }
}

export const COMPOSE_WORKING_DIR_LABEL = 'com.docker.compose.project.working_dir';
export const COMPOSE_PROJECT_LABEL = 'com.docker.compose.project';
