import fsp from 'node:fs/promises';
import path from 'node:path';
import type Docker from 'dockerode';
import type { IDockerClient } from '../../domain/ports.js';

const VOLUME_HELPER_IMAGE = 'alpine:3.20';

export async function listBackupableVolumes(dockerClient: IDockerClient): Promise<string[]> {
  const docker = dockerClient.getRaw() as Docker | null;
  if (!docker) return [];

  const result = await docker.listVolumes();
  const volumes = result.Volumes ?? [];
  return volumes
    .map((v) => v.Name)
    .filter((name) => Boolean(name) && !name.startsWith('dockora-'))
    .sort();
}

/** Exportiert ein Named Volume als tar.gz in destFile (Host-Pfad). */
export async function exportVolumeToTar(
  dockerClient: IDockerClient,
  volumeName: string,
  destFile: string,
): Promise<void> {
  const docker = dockerClient.getRaw() as Docker | null;
  if (!docker) throw new Error('Docker offline – Volume-Backup nicht möglich');

  await ensureHelperImage(docker);
  await fsp.mkdir(path.dirname(destFile), { recursive: true });
  const hostDir = path.dirname(destFile);
  const fileName = path.basename(destFile);

  const container = await docker.createContainer({
    Image: VOLUME_HELPER_IMAGE,
    Cmd: ['tar', 'czf', `/backup/${fileName}`, '-C', '/data', '.'],
    HostConfig: {
      AutoRemove: true,
      Binds: [`${volumeName}:/data:ro`, `${hostDir}:/backup`],
    },
  });

  await container.start();
  const result = await container.wait();
  if (result.StatusCode !== 0) {
    throw new Error(`Volume export failed for ${volumeName} (exit ${result.StatusCode})`);
  }
}

/** Stellt Volume aus tar.gz wieder her (legt Volume bei Bedarf an). */
export async function importVolumeFromTar(
  dockerClient: IDockerClient,
  volumeName: string,
  tarFile: string,
): Promise<void> {
  const docker = dockerClient.getRaw() as Docker | null;
  if (!docker) throw new Error('Docker offline – Volume-Restore nicht möglich');

  await ensureHelperImage(docker);

  try {
    await docker.getVolume(volumeName).inspect();
  } catch {
    await docker.createVolume({ Name: volumeName });
  }

  const hostDir = path.dirname(tarFile);
  const fileName = path.basename(tarFile);

  const container = await docker.createContainer({
    Image: VOLUME_HELPER_IMAGE,
    Cmd: ['sh', '-c', `rm -rf /data/* /data/.[!.]* 2>/dev/null; tar xzf /backup/${fileName} -C /data`],
    HostConfig: {
      AutoRemove: true,
      Binds: [`${volumeName}:/data`, `${hostDir}:/backup:ro`],
    },
  });

  await container.start();
  const result = await container.wait();
  if (result.StatusCode !== 0) {
    throw new Error(`Volume import failed for ${volumeName} (exit ${result.StatusCode})`);
  }
}

async function ensureHelperImage(docker: Docker): Promise<void> {
  try {
    await docker.getImage(VOLUME_HELPER_IMAGE).inspect();
  } catch {
    await new Promise<void>((resolve, reject) => {
      docker.pull(VOLUME_HELPER_IMAGE, (err: Error | null, stream: NodeJS.ReadableStream) => {
        if (err) {
          reject(err);
          return;
        }
        docker.modem.followProgress(stream, (followErr: Error | null) => {
          if (followErr) reject(followErr);
          else resolve();
        });
      });
    });
  }
}
