import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { ComposeProjectStatus } from '@dockora/shared';
import { mapPool } from '../../infrastructure/async/map-pool.js';
import { createTtlMemo } from '../../infrastructure/cache/ttl-memo.js';
import type { DockerContainerInfo } from '../../domain/ports.js';

export const COMPOSE_FILENAMES = [
  'compose.yaml',
  'compose.yml',
  'docker-compose.yml',
  'docker-compose.yaml',
] as const;

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.cache',
  '.local',
  '.npm',
  '.pnpm-store',
  '.next',
  '.turbo',
  'dist',
  'coverage',
  'vendor',
  '__pycache__',
  '.venv',
  'venv',
  'lost+found',
]);
const COMPOSE_PROJECT_LABEL = 'com.docker.compose.project';
const MAX_DEPTH = 4;
const SCAN_CONCURRENCY = 8;
const DISCOVERY_TTL_MS = 8_000;

export interface DiscoveredComposeProject {
  name: string;
  path: string;
  composeFile: string;
  absoluteComposePath: string;
}

const discoveryMemo = createTtlMemo<DiscoveredComposeProject[]>(DISCOVERY_TTL_MS);
let discoveryKey = '';

export function encodeComposeId(absolutePath: string): string {
  return Buffer.from(absolutePath, 'utf8').toString('base64url');
}

export function decodeComposeId(id: string): string {
  return Buffer.from(id, 'base64url').toString('utf8');
}

export function invalidateComposeDiscoveryCache(): void {
  discoveryMemo.clear();
  discoveryKey = '';
}

export async function discoverComposeProjects(
  searchPaths: string[],
  excludePaths: string[] = [],
): Promise<DiscoveredComposeProject[]> {
  const key = JSON.stringify({
    search: searchPaths.map((p) => path.resolve(p)).sort(),
    exclude: excludePaths.map((p) => path.resolve(p)).sort(),
  });
  if (discoveryKey !== key) {
    discoveryMemo.clear();
    discoveryKey = key;
  }
  return discoveryMemo.get(() => scanAll(searchPaths, excludePaths));
}

async function scanAll(
  searchPaths: string[],
  excludePaths: string[],
): Promise<DiscoveredComposeProject[]> {
  const found = new Map<string, DiscoveredComposeProject>();
  const excludes = excludePaths.map((p) => path.resolve(p));

  for (const searchPath of searchPaths) {
    await scanDirectory(searchPath, 0, found, excludes);
  }

  return [...found.values()]
    .filter((p) => !isExcluded(p.path, excludes))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function resolveDiscoveredProject(
  id: string,
  searchPaths: string[],
  excludePaths: string[] = [],
): Promise<DiscoveredComposeProject | null> {
  let absolutePath: string;
  try {
    absolutePath = path.resolve(decodeComposeId(id));
  } catch {
    return null;
  }

  const composeFile = path.basename(absolutePath);
  const dir = path.dirname(absolutePath);
  const excludes = excludePaths.map((p) => path.resolve(p));
  const allowed = searchPaths.some((sp) => isInside(absolutePath, path.resolve(sp)));

  if (
    allowed &&
    (COMPOSE_FILENAMES as readonly string[]).includes(composeFile) &&
    !isExcluded(dir, excludes)
  ) {
    try {
      const info = await stat(absolutePath);
      if (info.isFile()) {
        return {
          name: path.basename(dir),
          path: dir,
          composeFile,
          absoluteComposePath: absolutePath,
        };
      }
    } catch {
      // missing file — fall through to discovery
    }
  }

  const projects = await discoverComposeProjects(searchPaths, excludePaths);
  return projects.find((p) => path.resolve(p.absoluteComposePath) === absolutePath) ?? null;
}

function isInside(child: string, parent: string): boolean {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function isExcluded(projectPath: string, excludes: string[]): boolean {
  const resolved = path.resolve(projectPath);
  return excludes.some((ex) => resolved === ex || resolved.startsWith(ex + path.sep));
}

async function scanDirectory(
  dir: string,
  depth: number,
  found: Map<string, DiscoveredComposeProject>,
  excludes: string[],
): Promise<void> {
  if (depth > MAX_DEPTH) return;
  if (isExcluded(dir, excludes)) return;

  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  const fileNames = new Set(
    entries.filter((e) => e.isFile() || e.isSymbolicLink()).map((e) => e.name),
  );
  for (const filename of COMPOSE_FILENAMES) {
    if (!fileNames.has(filename)) continue;
    const absoluteComposePath = path.resolve(dir, filename);
    if (!found.has(absoluteComposePath) && !isExcluded(dir, excludes)) {
      found.set(absoluteComposePath, {
        name: path.basename(dir),
        path: dir,
        composeFile: filename,
        absoluteComposePath,
      });
    }
    break;
  }

  if (depth >= MAX_DEPTH) return;

  const children = entries
    .filter((entry) => entry.isDirectory() && !SKIP_DIRS.has(entry.name))
    .map((entry) => path.join(dir, entry.name))
    .filter((child) => !isExcluded(child, excludes));

  await mapPool(children, SCAN_CONCURRENCY, async (child) => {
    await scanDirectory(child, depth + 1, found, excludes);
  });
}

export function resolveComposeStatus(
  projectName: string,
  containers: DockerContainerInfo[],
): { status: ComposeProjectStatus; containerCount: number; runningCount: number } {
  const projectContainers = containers.filter(
    (c) => c.labels[COMPOSE_PROJECT_LABEL] === projectName,
  );

  if (projectContainers.length === 0) {
    return { status: 'unknown', containerCount: 0, runningCount: 0 };
  }

  const runningCount = projectContainers.filter(
    (c) => c.status === 'running' || c.status === 'paused' || c.status === 'restarting',
  ).length;

  let status: ComposeProjectStatus;
  if (runningCount === 0) {
    status = 'stopped';
  } else if (runningCount === projectContainers.length) {
    status = 'running';
  } else {
    status = 'partial';
  }

  return { status, containerCount: projectContainers.length, runningCount };
}

export async function readComposeYaml(composeFilePath: string): Promise<string> {
  return readFile(composeFilePath, 'utf8');
}

export function extractServiceNames(yamlContent: string): string[] {
  try {
    const lines = yamlContent.split('\n');
    const services: string[] = [];
    let inServices = false;

    for (const line of lines) {
      if (/^services:\s*$/.test(line)) {
        inServices = true;
        continue;
      }
      if (inServices) {
        if (/^[a-zA-Z_][\w.-]*:\s*$/.test(line) && !line.startsWith(' ')) {
          break;
        }
        const match = line.match(/^  ([a-zA-Z_][\w.-]*):\s*$/);
        if (match?.[1]) {
          services.push(match[1]);
        }
      }
    }

    return services;
  } catch {
    return [];
  }
}

export async function findEnvFiles(projectDir: string): Promise<string[]> {
  const candidates = ['.env', '.env.local', '.env.production'];
  const existing: string[] = [];

  for (const name of candidates) {
    const full = path.join(projectDir, name);
    try {
      const info = await stat(full);
      if (info.isFile()) existing.push(name);
    } catch {
      // not found
    }
  }

  return existing;
}
