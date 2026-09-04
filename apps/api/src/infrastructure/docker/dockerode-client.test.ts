import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createDockerClient, OfflineDockerClient } from './dockerode-client.js';

describe('OfflineDockerClient', () => {
  it('returns empty lists and rejects mutating calls', async () => {
    const docker = new OfflineDockerClient();
    expect(await docker.ping()).toBe(false);
    expect(await docker.listContainers()).toEqual([]);
    expect(await docker.listImages()).toEqual([]);
    expect(await docker.listVolumes()).toEqual([]);
    expect(docker.getRecentEvents()).toEqual([]);
    await expect(docker.getVersion()).rejects.toThrow(/offline/i);
    const unsub = docker.subscribeResourceChanges(() => undefined);
    expect(typeof unsub).toBe('function');
    unsub();
  });
});

describe('createDockerClient', () => {
  it('returns a Dockerode client even when the socket is missing', () => {
    const client = createDockerClient('/tmp/dockora-missing-docker.sock');
    expect(client).toBeTruthy();
    expect(typeof client.ping).toBe('function');
  });
});

const SOCKET = '/var/run/docker.sock';

describe.skipIf(!existsSync(SOCKET))('DockerodeClient (live daemon)', () => {
  it('pings the local engine', async () => {
    const client = createDockerClient(SOCKET);
    await expect(client.ping()).resolves.toBe(true);
    const version = await client.getVersion();
    expect(version.version).toMatch(/\d+/);
    client.stopEventListener();
  }, 15_000);
});
