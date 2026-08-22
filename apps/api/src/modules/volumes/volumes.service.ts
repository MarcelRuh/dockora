import type { VolumeBrowseEntry, VolumeSummary } from '@dockora/shared';
import { isProtectedDockerVolume } from '../../domain/dockora-self.js';
import type { DockerVolumeInfo, IDockerClient } from '../../domain/ports.js';

export class VolumesService {
  constructor(private readonly docker: IDockerClient) {}

  async list(): Promise<VolumeSummary[]> {
    const volumes = await this.docker.listVolumes();
    return volumes
      .map(toSummary)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async prune(): Promise<{
    ok: true;
    message: string;
    volumesDeleted: number;
    spaceReclaimed: number;
  }> {
    const volumes = await this.docker.listVolumes();
    let volumesDeleted = 0;
    let spaceReclaimed = 0;

    for (const volume of volumes) {
      const summary = toSummary(volume);
      if (!summary.unused || summary.protected) continue;
      try {
        await this.docker.removeVolume(volume.name);
        volumesDeleted += 1;
        spaceReclaimed += summary.sizeBytes ?? 0;
      } catch {
        // In-use or already gone – skip
      }
    }

    return {
      ok: true,
      message: `Pruned ${volumesDeleted} volume(s), reclaimed ${spaceReclaimed} bytes`,
      volumesDeleted,
      spaceReclaimed,
    };
  }

  async remove(name: string): Promise<{ ok: true; message: string }> {
    if (isProtectedDockerVolume(name)) {
      throw new VolumeGuardError(`Volume ${name} belongs to Dockora and cannot be removed`);
    }
    const volumes = await this.docker.listVolumes();
    const current = volumes.find((v) => v.name === name);
    if (current && (current.refCount > 0 || current.usedBy.length > 0)) {
      throw new VolumeGuardError(`Volume ${name} is in use and cannot be removed`);
    }
    await this.docker.removeVolume(name);
    return { ok: true, message: `Volume removed: ${name}` };
  }

  async browse(name: string): Promise<VolumeBrowseEntry[]> {
    return this.docker.browseVolume(name);
  }
}

export class VolumeGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VolumeGuardError';
  }
}

function toSummary(volume: DockerVolumeInfo): VolumeSummary {
  const protectedVol = isProtectedDockerVolume(volume.name);
  // sizeBytes kommt aus `docker system df`. Fehlt es, nicht als unused behandeln
  // (sonst würde Prune bei fehlgeschlagenem df alle Volumes für ungenutzt halten).
  const unused =
    !protectedVol &&
    volume.refCount <= 0 &&
    volume.usedBy.length === 0 &&
    volume.sizeBytes != null;
  return {
    name: volume.name,
    driver: volume.driver,
    mountpoint: volume.mountpoint,
    createdAt: volume.createdAt,
    sizeBytes: volume.sizeBytes,
    refCount: volume.refCount,
    usedBy: volume.usedBy,
    unused,
    protected: protectedVol,
  };
}
