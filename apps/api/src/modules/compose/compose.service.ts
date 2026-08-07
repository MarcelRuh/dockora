import { execFile } from 'node:child_process';
import { access, copyFile, mkdir, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import YAML from 'yaml';
import type {
  ActionResult,
  BackupInfo,
  ComposeAction,
  ComposeProjectDetails,
  ComposeProjectSummary,
} from '@dockora/shared';
import { isDockoraSelfComposeProject } from '../../domain/dockora-self.js';
import type { IDockerClient } from '../../domain/ports.js';
import {
  COMPOSE_FILENAMES,
  decodeComposeId,
  discoverComposeProjects,
  encodeComposeId,
  extractServiceNames,
  findEnvFiles,
  readComposeYaml,
  resolveComposeStatus,
} from './compose-discovery.js';

const execFileAsync = promisify(execFile);

const ALLOWED_ENV_FILES = new Set(['.env', '.env.local', '.env.production']);

export interface ComposeServiceDeps {
  docker: IDockerClient;
  searchPaths: string[];
  excludePaths?: string[];
}

export class ComposeService {
  constructor(private readonly deps: ComposeServiceDeps) {}

  async list(): Promise<ComposeProjectSummary[]> {
    const [projects, containers] = await Promise.all([
      discoverComposeProjects(this.deps.searchPaths, this.deps.excludePaths ?? []),
      this.deps.docker.listContainers(true),
    ]);

    return projects
      .filter((p) => !isDockoraSelfComposeProject({ name: p.name, path: p.path }))
      .map((p) => {
        const { status, containerCount, runningCount } = resolveComposeStatus(p.name, containers);
        return {
          id: encodeComposeId(p.absoluteComposePath),
          name: p.name,
          path: p.path,
          composeFile: p.composeFile,
          status,
          containerCount,
          runningCount,
        };
      });
  }

  async getDetails(id: string): Promise<ComposeProjectDetails> {
    const project = await this.resolveProject(id);
    const [yaml, envFiles, containers] = await Promise.all([
      readComposeYaml(project.absoluteComposePath),
      findEnvFiles(project.path),
      this.deps.docker.listContainers(true),
    ]);

    const { status, containerCount, runningCount } = resolveComposeStatus(
      project.name,
      containers,
    );

    return {
      id: encodeComposeId(project.absoluteComposePath),
      name: project.name,
      path: project.path,
      composeFile: project.composeFile,
      status,
      containerCount,
      runningCount,
      yaml,
      services: extractServiceNames(yaml),
      envFiles,
    };
  }

  async runAction(id: string, action: ComposeAction): Promise<ActionResult> {
    const project = await this.resolveProject(id);
    const args = await buildComposeArgs(project, action);
    await execCompose(args, { cwd: project.path });
    return { ok: true, message: `Compose ${action} succeeded for ${project.name}` };
  }

  async logs(id: string): Promise<string> {
    const project = await this.resolveProject(id);
    const args = await withEnvFile(project, [
      '--project-directory',
      project.path,
      '-f',
      project.absoluteComposePath,
      'logs',
      '--no-color',
      '--tail',
      '200',
    ]);
    const { stdout } = await execCompose(args, { cwd: project.path });
    return stdout;
  }

  async validateConfig(id: string): Promise<string> {
    const project = await this.resolveProject(id);
    const envPath = path.join(project.path, '.env');
    const args = ['--project-directory', project.path, '-f', project.absoluteComposePath];
    let hadEnv = false;
    try {
      await access(envPath);
      args.push('--env-file', envPath);
      hadEnv = true;
    } catch {
      // .env optional
    }
    args.push('config');
    try {
      const { stdout } = await execCompose(args, { cwd: project.path });
      return stdout;
    } catch (error) {
      const message =
        error instanceof Error
          ? ((error as { stderr?: string }).stderr?.trim() || error.message)
          : 'Invalid compose config';
      throw new ComposeValidationError(hintMissingEnv(message, hadEnv));
    }
  }

  async updateYaml(id: string, content: string): Promise<ComposeProjectDetails> {
    const project = await this.resolveProject(id);
    const tmpPath = `${project.absoluteComposePath}.dockora-tmp`;
    const envPath = path.join(project.path, '.env');

    await writeFile(tmpPath, content, 'utf8');
    try {
      const args = ['--project-directory', project.path, '-f', tmpPath];
      try {
        await access(envPath);
        args.push('--env-file', envPath);
      } catch {
        // .env optional
      }
      args.push('config');
      await execCompose(args, { cwd: project.path });
    } catch (error) {
      await unlink(tmpPath).catch(() => undefined);
      const message =
        error instanceof Error
          ? ((error as { stderr?: string }).stderr?.trim() || error.message)
          : 'Invalid compose YAML';
      throw new ComposeValidationError(hintMissingEnv(message, true));
    }

    await writeFile(project.absoluteComposePath, content, 'utf8');
    await unlink(tmpPath).catch(() => undefined);
    return this.getDetails(id);
  }

  async getEnvFile(
    id: string,
    fileName = '.env',
  ): Promise<{ fileName: string; content: string; exists: boolean }> {
    const project = await this.resolveProject(id);
    const safe = assertAllowedEnvFile(fileName);
    const full = path.join(project.path, safe);
    try {
      const content = await readFile(full, 'utf8');
      return { fileName: safe, content, exists: true };
    } catch {
      return { fileName: safe, content: '', exists: false };
    }
  }

  async updateEnvFile(
    id: string,
    content: string,
    fileName = '.env',
  ): Promise<ComposeProjectDetails> {
    const project = await this.resolveProject(id);
    const safe = assertAllowedEnvFile(fileName);
    if (content.includes('\0')) {
      throw new ComposeValidationError('Env file contains invalid null bytes');
    }
    if (content.length > 256_000) {
      throw new ComposeValidationError('Env file too large (max 256KB)');
    }
    await writeFile(path.join(project.path, safe), content, 'utf8');
    return this.getDetails(id);
  }

  /**
   * Recreate eines Compose-Service mit Image-Pin (Tag oder Digest).
   * YAML wird temporär umgeschrieben und danach wiederhergestellt.
   * `--pull never` verhindert, dass Compose erneut das Tag-Image zieht.
   */
  async recreatePinned(
    id: string,
    opts: { serviceName: string; imageRef: string },
  ): Promise<ActionResult> {
    const project = await this.resolveProject(id);
    const serviceName = opts.serviceName.trim();
    if (!serviceName || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(serviceName)) {
      throw new ComposeValidationError(`Invalid compose service name: ${opts.serviceName}`);
    }
    if (!opts.imageRef?.trim()) {
      throw new ComposeValidationError('imageRef is required for pinned recreate');
    }

    const original = await readComposeYaml(project.absoluteComposePath);
    let pinned: string;
    try {
      pinned = pinServiceImage(original, serviceName, opts.imageRef.trim());
    } catch (error) {
      throw new ComposeValidationError(
        error instanceof Error ? error.message : 'Failed to pin service image in YAML',
      );
    }

    const bakPath = `${project.absoluteComposePath}.dockora-pin.bak`;
    await writeFile(bakPath, original, 'utf8');
    await writeFile(project.absoluteComposePath, pinned, 'utf8');

    try {
      const args = await withEnvFile(project, [
        '--project-directory',
        project.path,
        '-f',
        project.absoluteComposePath,
        'up',
        '-d',
        '--force-recreate',
        '--no-deps',
        '--pull',
        'never',
        serviceName,
      ]);
      await execCompose(args, { cwd: project.path });
      return {
        ok: true,
        message: `Compose service ${serviceName} recreated with ${opts.imageRef}`,
      };
    } finally {
      await writeFile(project.absoluteComposePath, original, 'utf8').catch(() => undefined);
      await unlink(bakPath).catch(() => undefined);
    }
  }

  async backup(id: string): Promise<BackupInfo> {
    const project = await this.resolveProject(id);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupDir = path.join(project.path, '.dockora', 'backups', timestamp);
    await mkdir(backupDir, { recursive: true });

    const includes: string[] = [];
    const composeDest = path.join(backupDir, project.composeFile);
    await copyFile(project.absoluteComposePath, composeDest);
    includes.push(project.composeFile);

    const envPath = path.join(project.path, '.env');
    try {
      const envDest = path.join(backupDir, '.env');
      await copyFile(envPath, envDest);
      includes.push('.env');
    } catch {
      // .env optional
    }

    return {
      id: timestamp,
      name: `${project.name}-${timestamp}`,
      format: 'tar.gz',
      sizeBytes: 0,
      createdAt: new Date().toISOString(),
      path: backupDir,
      includes,
    };
  }

  /**
   * Legt ein neues Compose-Projekt unter einem erlaubten Suchpfad an.
   */
  async create(input: {
    name: string;
    basePath: string;
    composeFileName?: string;
    yaml: string;
    envContent?: string;
    start?: boolean;
  }): Promise<ComposeProjectDetails> {
    const name = input.name.trim();
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(name)) {
      throw new ComposeValidationError(
        'Invalid project name (letters, numbers, _ and -; max 64 chars)',
      );
    }

    if (!input.yaml?.trim()) {
      throw new ComposeValidationError('Compose YAML content is required');
    }

    if (input.yaml.length > 512_000) {
      throw new ComposeValidationError('Compose YAML too large (max 512KB)');
    }

    if (input.yaml.includes('\0')) {
      throw new ComposeValidationError('Compose YAML contains invalid null bytes');
    }

    const serviceNames = extractServiceNames(input.yaml);
    if (serviceNames.length === 0) {
      throw new ComposeValidationError('Compose file must define at least one service under "services:"');
    }

    // Grobe Sicherheitsheuristik – kein Ersatz für Policy-Engines
    if (/^\s*privileged:\s*true\b/im.test(input.yaml)) {
      throw new ComposeValidationError('privileged: true is not allowed via Dockora create');
    }
    if (/^\s*network_mode:\s*["']?host["']?\b/im.test(input.yaml)) {
      throw new ComposeValidationError('network_mode: host is not allowed via Dockora create');
    }

    const basePath = path.resolve(input.basePath.trim());
    const allowed = this.deps.searchPaths.some((sp) => {
      const resolved = path.resolve(sp);
      return basePath === resolved || basePath.startsWith(resolved + path.sep);
    });
    if (!allowed) {
      throw new ComposeValidationError(
        `basePath must be under configured search paths: ${this.deps.searchPaths.join(', ')}`,
      );
    }

    const composeFileName = input.composeFileName ?? 'compose.yaml';
    if (!COMPOSE_FILENAMES.includes(composeFileName as (typeof COMPOSE_FILENAMES)[number])) {
      throw new ComposeValidationError(`Invalid compose filename: ${composeFileName}`);
    }

    const projectDir = path.join(basePath, name);
    const composePath = path.join(projectDir, composeFileName);

    try {
      await access(composePath);
      throw new ComposeValidationError(`Project already exists: ${composePath}`);
    } catch (error) {
      if (error instanceof ComposeValidationError) throw error;
      // ENOENT → ok
    }

    try {
      // Basis-Suchpfad und Projektordner anlegen, falls noch nicht vorhanden
      await mkdir(basePath, { recursive: true });
      await mkdir(projectDir, { recursive: true });
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === 'EROFS' || err.code === 'EACCES') {
        throw new ComposeValidationError(
          `Cannot create project directory ${projectDir}: filesystem is read-only or not writable. ` +
            'Mount COMPOSE_SEARCH_PATHS read-write into the API container.',
        );
      }
      throw new ComposeValidationError(
        `Cannot create project directory ${projectDir}: ${err.message ?? String(error)}`,
      );
    }

    const envPath = path.join(projectDir, '.env');
    const hasEnv = Boolean(input.envContent?.trim());
    if (hasEnv) {
      // Vor `compose config` schreiben – sonst sind ${VAR}-Substitutionen leer
      // und Volume-Specs wie `${MEDIA_PATH}:/plex` werden zu `:/plex`.
      await writeFile(envPath, input.envContent!.trim() + '\n', 'utf8');
    }

    const tmpPath = `${composePath}.dockora-tmp`;
    await writeFile(tmpPath, input.yaml, 'utf8');
    try {
      const configArgs = ['--project-directory', projectDir, '-f', tmpPath];
      if (hasEnv) {
        configArgs.push('--env-file', envPath);
      }
      configArgs.push('config');
      await execCompose(configArgs, { cwd: projectDir });
    } catch (error) {
      await unlink(tmpPath).catch(() => undefined);
      if (hasEnv) await unlink(envPath).catch(() => undefined);
      const message =
        error instanceof Error
          ? ((error as { stderr?: string }).stderr?.trim() || error.message)
          : 'Invalid compose YAML';
      throw new ComposeValidationError(hintMissingEnv(message, hasEnv));
    }

    await writeFile(composePath, input.yaml, 'utf8');
    await unlink(tmpPath).catch(() => undefined);

    const id = encodeComposeId(composePath);

    if (input.start) {
      const upArgs = ['--project-directory', projectDir, '-f', composePath];
      if (hasEnv) upArgs.push('--env-file', envPath);
      upArgs.push('up', '-d');
      await execCompose(upArgs, { cwd: projectDir });
    }

    return this.getDetails(id);
  }

  listBasePaths(): string[] {
    return [...this.deps.searchPaths];
  }

  /**
   * Stoppt das Projekt (compose down) und löscht optional die Projektdateien.
   */
  async remove(
    id: string,
    options: { removeFiles?: boolean; removeVolumes?: boolean } = {},
  ): Promise<ActionResult> {
    const project = await this.resolveProject(id);
    const removeFiles = options.removeFiles !== false;
    const removeVolumes = options.removeVolumes === true;

    const downArgs = await withEnvFile(project, [
      '--project-directory',
      project.path,
      '-f',
      project.absoluteComposePath,
      'down',
    ]);
    if (removeVolumes) {
      downArgs.push('-v');
    }

    try {
      await execCompose(downArgs, { cwd: project.path });
    } catch (error) {
      // Wenn bereits gestoppt / keine Container: trotzdem Dateien löschen dürfen
      const message =
        error instanceof Error
          ? ((error as { stderr?: string }).stderr?.trim() || error.message)
          : String(error);
      if (!/no such|not found|no containers/i.test(message)) {
        throw error;
      }
    }

    if (removeFiles) {
      assertSafeProjectDir(project.path, this.deps.searchPaths);
      await rm(project.path, { recursive: true, force: true });
      return {
        ok: true,
        message: `Compose project ${project.name} stopped and files deleted (${project.path})`,
      };
    }

    return {
      ok: true,
      message: `Compose project ${project.name} stopped (files kept at ${project.path})`,
    };
  }

  private async resolveProject(id: string) {
    const absolutePath = decodeComposeId(id);
    const projects = await discoverComposeProjects(
      this.deps.searchPaths,
      this.deps.excludePaths ?? [],
    );
    const project = projects.find((p) => p.absoluteComposePath === absolutePath);
    if (!project) {
      throw new ComposeNotFoundError(`Compose project not found: ${absolutePath}`);
    }
    return project;
  }
}

export class ComposeNotFoundError extends Error {
  readonly statusCode = 404;
}

export class ComposeValidationError extends Error {
  readonly statusCode = 400;
}

/** Verhindert Löschen von Root-/Suchpfaden selbst. */
function assertSafeProjectDir(projectPath: string, searchPaths: string[]): void {
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
    ...searchPaths.map((p) => path.resolve(p)),
  ]);

  if (forbidden.has(resolved) || resolved === path.parse(resolved).root) {
    throw new ComposeValidationError(
      `Refusing to delete protected path: ${resolved}. Delete only project subdirectories.`,
    );
  }

  const underSearch = searchPaths.some((sp) => {
    const base = path.resolve(sp);
    return resolved.startsWith(base + path.sep);
  });
  if (!underSearch) {
    throw new ComposeValidationError(`Project path is outside search paths: ${resolved}`);
  }
}

async function withEnvFile(
  project: { path: string },
  args: string[],
): Promise<string[]> {
  const envPath = path.join(project.path, '.env');
  try {
    await access(envPath);
    // Insert after project-directory / before trailing command if possible
    const out = [...args];
    const fIdx = out.indexOf('-f');
    const insertAt = fIdx >= 0 ? fIdx + 2 : out.length;
    out.splice(insertAt, 0, '--env-file', envPath);
    return out;
  } catch {
    return args;
  }
}

async function buildComposeArgs(
  project: { path: string; absoluteComposePath: string },
  action: ComposeAction,
): Promise<string[]> {
  const base = await withEnvFile(project, [
    '--project-directory',
    project.path,
    '-f',
    project.absoluteComposePath,
  ]);

  switch (action) {
    case 'up':
      return [...base, 'up', '-d'];
    case 'down':
      return [...base, 'down'];
    case 'restart':
      return [...base, 'restart'];
    case 'pull':
      return [...base, 'pull'];
    case 'build':
      return [...base, 'build'];
    case 'recreate':
      return [...base, 'up', '-d', '--force-recreate'];
    case 'logs':
      return [...base, 'logs', '--no-color', '--tail', '200'];
    default:
      throw new Error(`Unknown compose action: ${action as string}`);
  }
}

async function execCompose(
  args: string[],
  options?: { cwd?: string },
): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync('docker', ['compose', ...args], {
    timeout: 300_000,
    maxBuffer: 4 * 1024 * 1024,
    cwd: options?.cwd,
  });
}

function hintMissingEnv(message: string, hadEnvAttempt: boolean): string {
  if (/empty section between colons|variable is not set/i.test(message)) {
    const tip = hadEnvAttempt
      ? ' Prüfe die .env-Werte (keine leeren Pfade für Volumes).'
      : ' Füge im Create-Dialog den .env-Inhalt ein (Feld „.env optional“) – ${VAR}-Platzhalter brauchen diese Datei.';
    return `${message}${tip}`;
  }
  return message;
}

function assertAllowedEnvFile(fileName: string): string {
  const base = path.basename(fileName);
  if (!ALLOWED_ENV_FILES.has(base) || base !== fileName) {
    throw new ComposeValidationError(
      `Env file not allowed: ${fileName} (allowed: ${[...ALLOWED_ENV_FILES].join(', ')})`,
    );
  }
  return base;
}

/** Setzt services.<name>.image auf imageRef (YAML-Document-API). */
export function pinServiceImage(yamlContent: string, serviceName: string, imageRef: string): string {
  const doc = YAML.parseDocument(yamlContent);
  const services = doc.get('services');
  if (!YAML.isMap(services)) {
    throw new Error('Compose YAML has no services map');
  }
  const service = services.get(serviceName);
  if (service == null) {
    throw new Error(`Service "${serviceName}" not found in compose YAML`);
  }
  if (YAML.isMap(service)) {
    service.set('image', imageRef);
  } else {
    throw new Error(`Service "${serviceName}" is not a mapping`);
  }
  return String(doc);
}
