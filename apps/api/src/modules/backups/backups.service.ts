import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { TarArchive, ZipArchive } from 'archiver';
import { COMPOSE_FILENAMES, type BackupFormat, type BackupInfo } from '@dockora/shared';
import { prisma } from '../../infrastructure/db/prisma.js';
import type { SettingsService } from '../settings/settings.service.js';
import type { IDockerClient } from '../../domain/ports.js';
import {
  exportVolumeToTar,
  importVolumeFromTar,
  listBackupableVolumes,
} from './volume-backup.js';
import {
  redactSettingsForBackup,
  stripSecretsFromRestoredSettings,
} from '../settings/secret-hygiene.js';

const execFileAsync = promisify(execFile);

export const BACKUP_DIR =
  process.env.BACKUP_DIR ?? path.join(process.cwd(), 'data', 'backups');

export interface BackupsServiceDeps {
  settings: SettingsService;
  backupDir?: string;
  docker?: IDockerClient;
}

export interface CreateBackupOptions {
  format?: BackupFormat;
  includeVolumes?: boolean;
}

export interface RestoreBackupOptions {
  /** Muss true sein, sonst wird nur extrahiert (Dry-Info). */
  confirm?: boolean;
  applyFiles?: boolean;
  applySettings?: boolean;
  applyVolumes?: boolean;
}

export interface BackupManifestFile {
  kind: 'compose' | 'env' | 'settings' | 'volume';
  sourcePath: string;
  archivePath: string;
}

export interface BackupManifest {
  version: 1;
  createdAt: string;
  includeVolumes: boolean;
  files: BackupManifestFile[];
}

export interface RestoreResult {
  ok: boolean;
  message: string;
  extractedTo: string;
  appliedFiles: number;
  appliedSettings: boolean;
  appliedVolumes: number;
  backedUpFiles: string[];
}

export class BackupsService {
  private readonly backupDir: string;

  constructor(private readonly deps: BackupsServiceDeps) {
    this.backupDir = deps.backupDir ?? BACKUP_DIR;
  }

  async ensureBackupDir(): Promise<void> {
    await fsp.mkdir(this.backupDir, { recursive: true });
  }

  async list(): Promise<BackupInfo[]> {
    const rows = await prisma.backupRecord.findMany({ orderBy: { createdAt: 'desc' } });
    return rows.map(mapRow);
  }

  async create(options: CreateBackupOptions = {}): Promise<BackupInfo> {
    await this.ensureBackupDir();

    const settings = await this.deps.settings.getSettings();
    const format = options.format ?? settings.backupFormat;
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const name = `dockora-backup-${timestamp}`;
    const ext = format === 'zip' ? 'zip' : format === 'tar' ? 'tar' : 'tar.gz';
    const filePath = path.join(this.backupDir, `${name}.${ext}`);

    const { composeFiles, envFiles } = await discoverComposeAndEnv(settings.composeSearchPaths);

    const manifestFiles: BackupManifestFile[] = [];
    const archiveEntries: Array<{ absolutePath: string; archivePath: string }> = [];

    let index = 0;
    for (const composePath of composeFiles) {
      index += 1;
      const archivePath = `files/${String(index).padStart(4, '0')}/${path.basename(composePath)}`;
      manifestFiles.push({ kind: 'compose', sourcePath: composePath, archivePath });
      archiveEntries.push({ absolutePath: composePath, archivePath });
    }
    for (const envPath of envFiles) {
      index += 1;
      const archivePath = `files/${String(index).padStart(4, '0')}/${path.basename(envPath)}`;
      manifestFiles.push({ kind: 'env', sourcePath: envPath, archivePath });
      archiveEntries.push({ absolutePath: envPath, archivePath });
    }

    const volumeTmpFiles: string[] = [];
    const includeVolumes = options.includeVolumes === true;
    if (includeVolumes) {
      if (!this.deps.docker) {
        throw new Error('Docker client fehlt für Volume-Backups');
      }
      const volumes = await listBackupableVolumes(this.deps.docker);
      const volDir = path.join(this.backupDir, `.tmp-volumes-${timestamp}`);
      await fsp.mkdir(volDir, { recursive: true });
      for (const volumeName of volumes) {
        const safe = volumeName.replace(/[^a-zA-Z0-9._-]/g, '_');
        const archivePath = `volumes/${safe}.tar.gz`;
        const tmpFile = path.join(volDir, `${safe}.tar.gz`);
        await exportVolumeToTar(this.deps.docker, volumeName, tmpFile);
        volumeTmpFiles.push(tmpFile);
        manifestFiles.push({ kind: 'volume', sourcePath: volumeName, archivePath });
        archiveEntries.push({ absolutePath: tmpFile, archivePath });
      }
    }

    const settingsJson = JSON.stringify(
      redactSettingsForBackup(await this.deps.settings.getSettings() as unknown as Record<string, unknown>),
      null,
      2,
    );
    const settingsTmp = path.join(this.backupDir, `.tmp-settings-${timestamp}.json`);
    await fsp.writeFile(settingsTmp, settingsJson, 'utf8');
    const settingsArchivePath = 'settings/settings.json';
    manifestFiles.push({
      kind: 'settings',
      sourcePath: 'dockora:settings',
      archivePath: settingsArchivePath,
    });
    archiveEntries.push({ absolutePath: settingsTmp, archivePath: settingsArchivePath });

    const manifest: BackupManifest = {
      version: 1,
      createdAt: new Date().toISOString(),
      includeVolumes,
      files: manifestFiles,
    };
    const manifestTmp = path.join(this.backupDir, `.tmp-manifest-${timestamp}.json`);
    await fsp.writeFile(manifestTmp, JSON.stringify(manifest, null, 2), 'utf8');
    archiveEntries.push({ absolutePath: manifestTmp, archivePath: 'manifest.json' });

    try {
      await createArchive(format, filePath, archiveEntries);
    } finally {
      await fsp.unlink(settingsTmp).catch(() => undefined);
      await fsp.unlink(manifestTmp).catch(() => undefined);
      for (const f of volumeTmpFiles) {
        await fsp.unlink(f).catch(() => undefined);
      }
      if (volumeTmpFiles.length > 0) {
        await fsp.rm(path.dirname(volumeTmpFiles[0]!), { recursive: true, force: true }).catch(() => undefined);
      }
    }

    const stat = await fsp.stat(filePath);
    const includes = manifestFiles.map((f) => {
      if (f.kind === 'settings') return 'settings.json';
      if (f.kind === 'volume') return `volume:${f.sourcePath}`;
      return f.sourcePath;
    });

    const row = await prisma.backupRecord.create({
      data: {
        name,
        format,
        path: filePath,
        sizeBytes: stat.size,
        includes: JSON.stringify(includes),
      },
    });

    return mapRow(row);
  }

  async delete(id: string): Promise<void> {
    const row = await prisma.backupRecord.findUnique({ where: { id } });
    if (!row) {
      throw new Error('Backup not found');
    }
    await fsp.unlink(row.path).catch(() => undefined);
    await prisma.backupRecord.delete({ where: { id } });
  }

  async restore(id: string, options: RestoreBackupOptions = {}): Promise<RestoreResult> {
    const row = await prisma.backupRecord.findUnique({ where: { id } });
    if (!row) {
      throw new Error('Backup not found');
    }

    const extractDir = path.join(this.backupDir, 'restore', row.name);
    await fsp.mkdir(extractDir, { recursive: true });
    await extractArchive(row.format as BackupFormat, row.path, extractDir);

    const applyFiles = options.applyFiles !== false;
    const applySettings = options.applySettings !== false;
    const applyVolumes = options.applyVolumes !== false;

    if (!options.confirm) {
      return {
        ok: true,
        message:
          'Backup extrahiert. Zum Anwenden erneut mit { confirm: true } aufrufen (Dateien + Settings + Volumes).',
        extractedTo: extractDir,
        appliedFiles: 0,
        appliedSettings: false,
        appliedVolumes: 0,
        backedUpFiles: [],
      };
    }

    const manifest = await readManifest(extractDir);
    const backedUpFiles: string[] = [];
    let appliedFiles = 0;
    let appliedSettings = false;
    let appliedVolumes = 0;

    for (const entry of manifest.files) {
      const src = path.join(extractDir, entry.archivePath);
      try {
        await fsp.access(src);
      } catch {
        continue;
      }

      if (entry.kind === 'settings') {
        if (!applySettings) continue;
        const raw = await fsp.readFile(src, 'utf8');
        const parsed = stripSecretsFromRestoredSettings(
          JSON.parse(raw) as Record<string, unknown>,
        );
        await this.deps.settings.updateSettings(parsed as never);
        appliedSettings = true;
        continue;
      }

      if (entry.kind === 'volume') {
        if (!applyVolumes) continue;
        if (!this.deps.docker) {
          throw new Error('Docker client fehlt für Volume-Restore');
        }
        await importVolumeFromTar(this.deps.docker, entry.sourcePath, src);
        appliedVolumes += 1;
        continue;
      }

      if (!applyFiles) continue;

      const target = entry.sourcePath;
      if (!path.isAbsolute(target)) {
        continue;
      }

      await fsp.mkdir(path.dirname(target), { recursive: true });
      try {
        await fsp.access(target);
        const bak = `${target}.bak.${Date.now()}`;
        await fsp.copyFile(target, bak);
        backedUpFiles.push(bak);
      } catch {
        // Ziel existierte noch nicht
      }
      await fsp.copyFile(src, target);
      appliedFiles += 1;
    }

    return {
      ok: true,
      message: `Restore angewendet: ${appliedFiles} Datei(en)${appliedSettings ? ', Settings' : ''}${appliedVolumes ? `, ${appliedVolumes} Volume(s)` : ''}.`,
      extractedTo: extractDir,
      appliedFiles,
      appliedSettings,
      appliedVolumes,
      backedUpFiles,
    };
  }

  async cleanup(): Promise<{ deleted: number }> {
    const settings = await this.deps.settings.getSettings();
    const retentionDays = settings.backupRetentionDays;
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

    const stale = await prisma.backupRecord.findMany({
      where: { createdAt: { lt: cutoff } },
    });

    let deleted = 0;
    for (const row of stale) {
      await fsp.unlink(row.path).catch(() => undefined);
      await prisma.backupRecord.delete({ where: { id: row.id } });
      deleted++;
    }

    return { deleted };
  }
}

function mapRow(row: {
  id: string;
  name: string;
  format: string;
  sizeBytes: number;
  createdAt: Date;
  path: string;
  includes: string;
}): BackupInfo {
  let includes: string[] = [];
  try {
    includes = JSON.parse(row.includes) as string[];
  } catch {
    includes = [];
  }

  return {
    id: row.id,
    name: row.name,
    format: row.format as BackupFormat,
    sizeBytes: row.sizeBytes,
    createdAt: row.createdAt.toISOString(),
    path: row.path,
    includes,
  };
}

async function readManifest(extractDir: string): Promise<BackupManifest> {
  const manifestPath = path.join(extractDir, 'manifest.json');
  try {
    const raw = await fsp.readFile(manifestPath, 'utf8');
    const parsed = JSON.parse(raw) as BackupManifest;
    if (parsed.version !== 1 || !Array.isArray(parsed.files)) {
      throw new Error('Unsupported manifest');
    }
    return parsed;
  } catch {
    // Legacy-Backups ohne Manifest: nichts anwenden können
    throw new Error(
      'Kein Manifest im Backup (älteres Format). Dateien liegen unter extractedTo – manuell prüfen.',
    );
  }
}

async function discoverComposeAndEnv(
  searchPaths: string[],
): Promise<{ composeFiles: string[]; envFiles: string[] }> {
  const composeFiles: string[] = [];
  const envFiles: string[] = [];
  const seen = new Set<string>();

  for (const root of searchPaths) {
    await walkDir(root, 4, async (filePath) => {
      const base = path.basename(filePath);
      if ((COMPOSE_FILENAMES as readonly string[]).includes(base)) {
        if (!seen.has(filePath)) {
          seen.add(filePath);
          composeFiles.push(filePath);
        }
        const dir = path.dirname(filePath);
        for (const envName of ['.env', '.env.local']) {
          const envPath = path.join(dir, envName);
          try {
            await fsp.access(envPath);
            if (!seen.has(envPath)) {
              seen.add(envPath);
              envFiles.push(envPath);
            }
          } catch {
            // ignore
          }
        }
      }
    });
  }

  return { composeFiles, envFiles };
}

async function walkDir(
  dir: string,
  maxDepth: number,
  onFile: (filePath: string) => Promise<void>,
  depth = 0,
): Promise<void> {
  if (depth > maxDepth) return;

  let entries: fs.Dirent[];
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.name !== '.env' && entry.name !== '.env.local') {
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['node_modules', '.git', 'dist', 'backups'].includes(entry.name)) {
        continue;
      }
      await walkDir(full, maxDepth, onFile, depth + 1);
    } else if (entry.isFile()) {
      await onFile(full);
    }
  }
}

async function createArchive(
  format: BackupFormat,
  destPath: string,
  entries: Array<{ absolutePath: string; archivePath: string }>,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const output = fs.createWriteStream(destPath);
    const archive =
      format === 'zip'
        ? new ZipArchive({ zlib: { level: 9 } })
        : new TarArchive({
            gzip: format === 'tar.gz',
            gzipOptions: { level: 9 },
          });

    output.on('close', () => resolve());
    archive.on('error', reject);
    output.on('error', reject);

    archive.pipe(output);

    for (const entry of entries) {
      archive.file(entry.absolutePath, { name: entry.archivePath });
    }

    void archive.finalize();
  });
}

async function extractArchive(
  format: BackupFormat,
  archivePath: string,
  destDir: string,
): Promise<void> {
  if (format === 'zip') {
    await execFileAsync('unzip', ['-o', archivePath, '-d', destDir]);
    return;
  }

  const args =
    format === 'tar.gz'
      ? ['-xzf', archivePath, '-C', destDir]
      : ['-xf', archivePath, '-C', destDir];
  await execFileAsync('tar', args);
}

/** Exported for tests */
export function archivePathForSource(sourcePath: string, index: number): string {
  const hash = createHash('sha1').update(sourcePath).digest('hex').slice(0, 8);
  return `files/${String(index).padStart(4, '0')}-${hash}/${path.basename(sourcePath)}`;
}
