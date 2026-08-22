import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { ComposeProjectStatus } from '@dockora/shared';
import type { DockerContainerInfo } from '../../domain/ports.js';

export const COMPOSE_FILENAMES = [
  'compose.yaml',
  'compose.yml',
  'docker-compose.yml',
  'docker-compose.yaml',
] as const;

const SKIP_DIRS = new Set(['node_modules', '.git']);
const COMPOSE_PROJECT_LABEL = 'com.docker.compose.project';
const MAX_DEPTH = 4;

export interface DiscoveredComposeProject {
  name: string;
  path: string;
  composeFile: string;
  absoluteComposePath: string;
}

export function encodeComposeId(absolutePath: string): string {
  return Buffer.from(absolutePath, 'utf8').toString('base64url');
}

export function decodeComposeId(id: string): string {
  return Buffer.from(id, 'base64url').toString('utf8');
}

export async function discoverComposeProjects(
  searchPaths: string[],
  excludePaths: string[] = [],
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

function isExcluded(projectPath: string, excludes: string[]): boolean {
  const resolved = path.resolve(projectPath);
  return excludes.some(
    (ex) => resolved === ex || resolved.startsWith(ex + path.sep),
  );
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

  for (const filename of COMPOSE_FILENAMES) {
    const candidate = path.join(dir, filename);
    try {
      const info = await stat(candidate);
      if (info.isFile()) {
        const absoluteComposePath = path.resolve(candidate);
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
    } catch {
      // file not present
    }
  }

  if (depth >= MAX_DEPTH) return;

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (SKIP_DIRS.has(entry.name)) continue;
    const child = path.join(dir, entry.name);
    if (isExcluded(child, excludes)) continue;
    await scanDirectory(child, depth + 1, found, excludes);
  }
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
