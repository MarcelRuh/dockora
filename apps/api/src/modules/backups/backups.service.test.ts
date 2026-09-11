import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../infrastructure/db/prisma.js', () => ({
  prisma: {
    backupRecord: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      delete: vi.fn(),
      create: vi.fn(),
    },
  },
}));

import { prisma } from '../../infrastructure/db/prisma.js';
import { BackupsService } from './backups.service.js';
import type { SettingsService } from '../settings/settings.service.js';

const execFileAsync = promisify(execFile);
const backupRecord = prisma.backupRecord as unknown as {
  findUnique: ReturnType<typeof vi.fn>;
  findMany: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
};

function settingsStub(searchPaths: string[], retentionDays = 7): SettingsService {
  return {
    getSettings: vi.fn().mockResolvedValue({
      composeSearchPaths: searchPaths,
      backupFormat: 'tar',
      backupRetentionDays: retentionDays,
    }),
    updateSettings: vi.fn().mockResolvedValue({}),
  } as unknown as SettingsService;
}

async function writeTar(archivePath: string, files: Record<string, string>): Promise<void> {
  const staging = await fsp.mkdtemp(path.join(os.tmpdir(), 'dockora-tar-'));
  try {
    for (const [name, content] of Object.entries(files)) {
      const abs = path.join(staging, name);
      await fsp.mkdir(path.dirname(abs), { recursive: true });
      await fsp.writeFile(abs, content, 'utf8');
    }
    await execFileAsync('tar', ['-cf', archivePath, '-C', staging, '.']);
  } finally {
    await fsp.rm(staging, { recursive: true, force: true });
  }
}

describe('BackupsService restore + cleanup', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'dockora-backup-test-'));
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await fsp.rm(tmp, { recursive: true, force: true });
  });

  it('restores compose files under the search path and skips host escapes', async () => {
    const searchRoot = path.join(tmp, 'compose-root');
    const target = path.join(searchRoot, 'stack', 'compose.yml');
    await fsp.mkdir(path.dirname(target), { recursive: true });

    const archivePath = path.join(tmp, 'ok.tar');
    await writeTar(archivePath, {
      'manifest.json': JSON.stringify({
        version: 1,
        createdAt: new Date().toISOString(),
        includeVolumes: false,
        files: [
          { kind: 'compose', sourcePath: target, archivePath: 'files/0001/compose.yml' },
          { kind: 'compose', sourcePath: '/etc/compose.yml', archivePath: 'files/0002/compose.yml' },
        ],
      }),
      'files/0001/compose.yml': 'services:\n  web:\n    image: nginx\n',
      'files/0002/compose.yml': 'evil: true\n',
    });

    backupRecord.findUnique.mockResolvedValue({
      id: 'b1',
      name: 'ok',
      format: 'tar',
      path: archivePath,
    });

    const service = new BackupsService({
      settings: settingsStub([searchRoot]),
      backupDir: path.join(tmp, 'backups'),
    });

    const result = await service.restore('b1', { confirm: true });
    expect(result.ok).toBe(true);
    expect(result.appliedFiles).toBe(1);
    expect(result.skippedFiles).toBe(1);
    expect(await fsp.readFile(target, 'utf8')).toContain('nginx');
    await expect(fsp.access('/etc/compose.yml')).rejects.toThrow();
  });

  it('rejects archives with path-traversal entries before extract', async () => {
    const archivePath = path.join(tmp, 'slip.tar');
    await execFileAsync('python3', [
      '-c',
      `
import io, tarfile
path = ${JSON.stringify(archivePath)}
tf = tarfile.open(path, 'w')
evil = tarfile.TarInfo('../evil.txt')
payload = b'nope'
evil.size = len(payload)
tf.addfile(evil, io.BytesIO(payload))
man = b'{"version":1,"createdAt":"x","includeVolumes":false,"files":[]}'
info = tarfile.TarInfo('manifest.json')
info.size = len(man)
tf.addfile(info, io.BytesIO(man))
tf.close()
`,
    ]);

    backupRecord.findUnique.mockResolvedValue({
      id: 'slip',
      name: 'slip',
      format: 'tar',
      path: archivePath,
    });

    const service = new BackupsService({
      settings: settingsStub([path.join(tmp, 'root')]),
      backupDir: path.join(tmp, 'backups'),
    });

    await expect(service.restore('slip', { confirm: true })).rejects.toThrow(/Unsafe archive entry/i);
  });

  it('skips invalid volume names instead of binding host paths', async () => {
    const archivePath = path.join(tmp, 'vol.tar');
    await writeTar(archivePath, {
      'manifest.json': JSON.stringify({
        version: 1,
        createdAt: new Date().toISOString(),
        includeVolumes: true,
        files: [
          {
            kind: 'volume',
            sourcePath: '../etc',
            archivePath: 'volumes/etc.tar.gz',
          },
        ],
      }),
      'volumes/etc.tar.gz': 'not-a-real-tar',
    });

    backupRecord.findUnique.mockResolvedValue({
      id: 'vol',
      name: 'vol',
      format: 'tar',
      path: archivePath,
    });

    const docker = { getRaw: vi.fn() };
    const service = new BackupsService({
      settings: settingsStub([path.join(tmp, 'root')]),
      backupDir: path.join(tmp, 'backups'),
      docker: docker as never,
    });

    const result = await service.restore('vol', { confirm: true, applyVolumes: true });
    expect(result.appliedVolumes).toBe(0);
    expect(result.skippedFiles).toBe(1);
    expect(docker.getRaw).not.toHaveBeenCalled();
  });

  it('cleanup deletes records older than retention', async () => {
    const oldPath = path.join(tmp, 'old.tar');
    await fsp.writeFile(oldPath, 'x');
    backupRecord.findMany.mockResolvedValue([{ id: 'old', path: oldPath, createdAt: new Date(0) }]);
    backupRecord.delete.mockResolvedValue({});

    const service = new BackupsService({
      settings: settingsStub(['/home'], 1),
      backupDir: path.join(tmp, 'backups'),
    });

    const result = await service.cleanup();
    expect(result.deleted).toBe(1);
    expect(backupRecord.delete).toHaveBeenCalledWith({ where: { id: 'old' } });
    await expect(fsp.access(oldPath)).rejects.toThrow();
  });

  it('dry-run restore does not write compose files', async () => {
    const searchRoot = path.join(tmp, 'compose-root');
    const target = path.join(searchRoot, 'stack', 'compose.yml');
    const archivePath = path.join(tmp, 'dry.tar');
    await writeTar(archivePath, {
      'manifest.json': JSON.stringify({
        version: 1,
        createdAt: new Date().toISOString(),
        includeVolumes: false,
        files: [{ kind: 'compose', sourcePath: target, archivePath: 'files/0001/compose.yml' }],
      }),
      'files/0001/compose.yml': 'services: {}\n',
    });

    backupRecord.findUnique.mockResolvedValue({
      id: 'dry',
      name: 'dry',
      format: 'tar',
      path: archivePath,
    });

    const service = new BackupsService({
      settings: settingsStub([searchRoot]),
      backupDir: path.join(tmp, 'backups'),
    });

    const result = await service.restore('dry', { confirm: false });
    expect(result.appliedFiles).toBe(0);
    expect(result.preview?.composeFiles).toEqual([target]);
    await expect(fsp.access(target)).rejects.toThrow();
  });
});
