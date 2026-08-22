import { describe, expect, it, vi } from 'vitest';
import type { DockerVolumeInfo, IDockerClient } from '../../domain/ports.js';
import { VolumeGuardError, VolumesService } from './volumes.service.js';

function vol(partial: Partial<DockerVolumeInfo> & { name: string }): DockerVolumeInfo {
  return {
    driver: 'local',
    mountpoint: `/var/lib/docker/volumes/${partial.name}/_data`,
    createdAt: '2026-08-01T00:00:00Z',
    sizeBytes: 1024,
    refCount: 0,
    usedBy: [],
    labels: {},
    ...partial,
  };
}

function docker(volumes: DockerVolumeInfo[]): IDockerClient {
  return {
    listVolumes: vi.fn().mockResolvedValue(volumes),
    removeVolume: vi.fn().mockResolvedValue(undefined),
    pruneVolumes: vi.fn(),
    browseVolume: vi.fn().mockResolvedValue([]),
  } as unknown as IDockerClient;
}

describe('VolumesService', () => {
  it('marks unused volumes and protects dockora_* names', async () => {
    const service = new VolumesService(
      docker([
        vol({ name: 'plex_config', sizeBytes: 50, refCount: 0 }),
        vol({ name: 'dockora_dockora-data', sizeBytes: 10, refCount: 0 }),
        vol({ name: 'immich_postgres', refCount: 1, usedBy: ['immich-db'] }),
      ]),
    );

    const list = await service.list();
    expect(list.find((v) => v.name === 'plex_config')?.unused).toBe(true);
    expect(list.find((v) => v.name === 'dockora_dockora-data')?.protected).toBe(true);
    expect(list.find((v) => v.name === 'dockora_dockora-data')?.unused).toBe(false);
    expect(list.find((v) => v.name === 'immich_postgres')?.unused).toBe(false);
  });

  it('does not mark volumes unused when size is unknown', async () => {
    const service = new VolumesService(
      docker([vol({ name: 'mystery', sizeBytes: null, refCount: 0, usedBy: [] })]),
    );
    expect((await service.list())[0]?.unused).toBe(false);
  });

  it('prunes only unused unprotected volumes', async () => {
    const client = docker([
      vol({ name: 'old_stack_data', sizeBytes: 2048 }),
      vol({ name: 'dockora_caddy-data', sizeBytes: 99 }),
      vol({ name: 'live_db', refCount: 1, usedBy: ['db'] }),
    ]);
    const service = new VolumesService(client);
    const result = await service.prune();

    expect(result.volumesDeleted).toBe(1);
    expect(result.spaceReclaimed).toBe(2048);
    expect(client.removeVolume).toHaveBeenCalledWith('old_stack_data');
    expect(client.removeVolume).not.toHaveBeenCalledWith('dockora_caddy-data');
    expect(client.removeVolume).not.toHaveBeenCalledWith('live_db');
  });

  it('refuses to remove protected or in-use volumes', async () => {
    const service = new VolumesService(
      docker([vol({ name: 'dockora-data' }), vol({ name: 'db', refCount: 1, usedBy: ['pg'] })]),
    );

    await expect(service.remove('dockora-data')).rejects.toBeInstanceOf(VolumeGuardError);
    await expect(service.remove('db')).rejects.toBeInstanceOf(VolumeGuardError);
  });
});
