import { existsSync } from 'node:fs';
import { Readable, Writable } from 'node:stream';
import Docker from 'dockerode';
import type Dockerode from 'dockerode';
import type { FastifyBaseLogger } from 'fastify';
import type {
  DockerContainerDetails,
  DockerContainerInfo,
  DockerEventInfo,
  DockerImageInfo,
  DockerResourceChange,
  DockerStatsSnapshot,
  DockerVersionInfo,
  DockerVolumeBrowseEntry,
  DockerVolumeInfo,
  IDockerClient,
} from '../../domain/ports.js';
import { formatPorts, mapContainerStatus } from '../../domain/container-utils.js';
import { withTimeout } from '../async/with-timeout.js';
import {
  isLiveContainerStatus,
  isNoisyDockerAction,
} from './resource-events.js';

const MAX_EVENTS = 100;
const COMPOSE_PROJECT_LABEL = 'com.docker.compose.project';
const COMPOSE_SERVICE_LABEL = 'com.docker.compose.service';
const VOLUME_HELPER_IMAGE = 'alpine:3.20';
const VOLUME_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,254}$/;

type DockerSystemDf = {
  Volumes?: Array<{ Name?: string; UsageData?: { Size?: number; RefCount?: number } }>;
  BuildCache?: Array<{ Size?: number }>;
};

export interface DockerodeClientOptions {
  socketPath: string;
  logger?: FastifyBaseLogger;
  maxEvents?: number;
}

type DemuxModem = {
  demuxStream: (
    stream: NodeJS.ReadableStream,
    stdout: Writable,
    stderr: Writable,
  ) => void;
};

/**
 * Dockerode-Adapter hinter IDockerClient.
 * Bei fehlendem Socket/Daemon: Methoden liefern leere/fehlerfreundliche Resultate.
 */
export class DockerodeClient implements IDockerClient {
  private readonly docker: Docker;
  private readonly logger?: FastifyBaseLogger;
  private readonly maxEvents: number;
  private readonly events: DockerEventInfo[] = [];
  private stream: NodeJS.ReadableStream | null = null;
  private listening = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private dfCache: { at: number; data: DockerSystemDf } | null = null;
  private dfInflight: Promise<DockerSystemDf> | null = null;
  private listCache = new Map<
    string,
    { at: number; value: DockerContainerInfo[]; inflight: Promise<DockerContainerInfo[]> | null }
  >();
  private imageCache: {
    at: number;
    value: DockerImageInfo[];
    inflight: Promise<DockerImageInfo[]> | null;
  } | null = null;
  private versionCache: { at: number; value: DockerVersionInfo } | null = null;
  private versionInflight: Promise<DockerVersionInfo> | null = null;
  private resourceListeners = new Set<(event: DockerResourceChange) => void>();

  constructor(options: DockerodeClientOptions) {
    this.logger = options.logger;
    this.maxEvents = options.maxEvents ?? MAX_EVENTS;
    this.docker = new Docker({ socketPath: options.socketPath });
  }

  getRaw(): Docker {
    return this.docker;
  }

  async ping(): Promise<boolean> {
    try {
      await this.docker.ping();
      return true;
    } catch (error) {
      this.logger?.debug({ err: error }, 'Docker ping failed');
      return false;
    }
  }

  async getVersion(): Promise<DockerVersionInfo> {
    const now = Date.now();
    if (this.versionCache && now - this.versionCache.at < 60_000) {
      return this.versionCache.value;
    }
    if (this.versionInflight) return this.versionInflight;

    this.versionInflight = withTimeout(
      this.docker.version(),
      10_000,
      'Docker version timeout',
    ).then((info) => {
      const value: DockerVersionInfo = {
        version: info.Version ?? 'unknown',
        apiVersion: info.ApiVersion ?? 'unknown',
        platformName: info.Platform?.Name,
        os: info.Os,
        arch: info.Arch,
      };
      this.versionCache = { at: Date.now(), value };
      return value;
    });
    try {
      return await this.versionInflight;
    } catch (error) {
      this.versionCache = null;
      throw error;
    } finally {
      this.versionInflight = null;
    }
  }

  async listContainers(all = true): Promise<DockerContainerInfo[]> {
    if (!all) {
      const allHit = this.listCache.get('all');
      const now = Date.now();
      if (allHit?.value && now - allHit.at < 2_500) {
        return allHit.value.filter((c) => isLiveContainerStatus(c.status));
      }
      if (allHit?.inflight) {
        const list = await allHit.inflight;
        return list.filter((c) => isLiveContainerStatus(c.status));
      }
    }

    const key = all ? 'all' : 'running';
    const now = Date.now();
    const hit = this.listCache.get(key);
    if (hit?.value && now - hit.at < 2_500) return hit.value;
    if (hit?.inflight) return hit.inflight;

    const inflight = withTimeout(
      this.docker.listContainers({ all }),
      15_000,
      'Docker listContainers timeout',
    ).then((list) => {
      const value = list.map((c) => mapListContainer(c));
      const at = Date.now();
      this.listCache.set(key, { at, value, inflight: null });
      if (all) {
        this.listCache.set('running', {
          at,
          value: value.filter((c) => isLiveContainerStatus(c.status)),
          inflight: null,
        });
      }
      return value;
    });
    this.listCache.set(key, { at: hit?.at ?? 0, value: hit?.value ?? [], inflight });
    try {
      return await inflight;
    } catch (error) {
      this.listCache.delete(key);
      throw error;
    }
  }

  async inspectContainer(id: string): Promise<DockerContainerDetails> {
    const container = this.docker.getContainer(id);
    const info = await withTimeout(container.inspect(), 10_000, `Docker inspect timeout (${id.slice(0, 12)})`);
    return mapInspectContainer(info);
  }

  async containerAction(
    id: string,
    action: 'start' | 'stop' | 'restart' | 'kill' | 'pause' | 'unpause' | 'remove',
    options?: { force?: boolean; timeout?: number },
  ): Promise<void> {
    const container = this.docker.getContainer(id);

    switch (action) {
      case 'start':
        await container.start();
        break;
      case 'stop':
        await container.stop({ t: options?.timeout });
        break;
      case 'restart':
        await container.restart({ t: options?.timeout });
        break;
      case 'kill':
        await container.kill();
        break;
      case 'pause':
        await container.pause();
        break;
      case 'unpause':
        await container.unpause();
        break;
      case 'remove':
        await container.remove({ force: options?.force });
        break;
    }
    this.invalidateListCache();
  }

  private invalidateListCache(): void {
    this.listCache.clear();
  }

  async getContainerLogs(
    id: string,
    options?: { tail?: number; timestamps?: boolean; stdout?: boolean; stderr?: boolean },
  ): Promise<string> {
    const container = this.docker.getContainer(id);
    const buffer = await container.logs({
      stdout: options?.stdout ?? true,
      stderr: options?.stderr ?? true,
      tail: options?.tail,
      timestamps: options?.timestamps ?? false,
      follow: false,
    });

    return demuxDockerOutput(container.modem as DemuxModem, buffer);
  }

  async streamContainerLogs(
    id: string,
    onData: (chunk: string) => void,
    options?: { tail?: number },
  ): Promise<{ close: () => void }> {
    const container = this.docker.getContainer(id);
    const stream = await container.logs({
      stdout: true,
      stderr: true,
      follow: true,
      tail: options?.tail ?? 100,
    });

    const stdout = new Writable({
      write(chunk, _encoding, callback) {
        onData(chunk.toString());
        callback();
      },
    });
    const stderr = new Writable({
      write(chunk, _encoding, callback) {
        onData(chunk.toString());
        callback();
      },
    });

    (container.modem as DemuxModem).demuxStream(stream, stdout, stderr);

    return {
      close: () => {
        if ('destroy' in stream) {
          (stream as NodeJS.ReadableStream & { destroy: () => void }).destroy();
        }
      },
    };
  }

  async getContainerStats(id: string): Promise<DockerStatsSnapshot> {
    const container = this.docker.getContainer(id);
    const stats = (await withTimeout(
      container.stats({ stream: false }) as Promise<Dockerode.ContainerStats>,
      8_000,
      `Docker stats timeout (${id.slice(0, 12)})`,
    )) as Dockerode.ContainerStats;
    return mapContainerStats(stats);
  }

  async listImages(): Promise<DockerImageInfo[]> {
    const now = Date.now();
    const hit = this.imageCache;
    if (hit?.value && now - hit.at < 5_000) return hit.value;
    if (hit?.inflight) return hit.inflight;

    const inflight = withTimeout(this.docker.listImages(), 20_000, 'Docker listImages timeout').then(
      (images) => {
        const value = images.map((img) => mapImageInfo(img));
        this.imageCache = { at: Date.now(), value, inflight: null };
        return value;
      },
    );
    this.imageCache = { at: hit?.at ?? 0, value: hit?.value ?? [], inflight };
    try {
      return await inflight;
    } catch (error) {
      this.imageCache = null;
      throw error;
    }
  }

  async pullImage(image: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.docker.pull(image, (err: Error | null, stream: NodeJS.ReadableStream) => {
        if (err) {
          reject(err);
          return;
        }
        this.docker.modem.followProgress(stream, (progressErr: Error | null) => {
          if (progressErr) {
            reject(progressErr);
            return;
          }
          resolve();
        });
      });
    });
    this.imageCache = null;
  }

  async tagImage(source: string, target: string): Promise<void> {
    const { repo, tag } = splitRepoTag(target);
    await this.docker.getImage(source).tag({ repo, tag });
    this.imageCache = null;
  }

  async removeImage(id: string, force = false): Promise<void> {
    const image = this.docker.getImage(id);
    await image.remove({ force });
    this.imageCache = null;
  }

  async pruneImages(
    danglingOnly = true,
  ): Promise<{ imagesDeleted: number; spaceReclaimed: number }> {
    // Docker default ohne Filter = nur dangling. Für „alle ungenutzten“
    // muss dangling=false explizit gesetzt werden (entspricht `docker image prune -a`).
    const filters = danglingOnly
      ? { dangling: ['true'] }
      : { dangling: ['false'] };
    const result = await this.docker.pruneImages({ filters });
    this.imageCache = null;
    return {
      imagesDeleted: result.ImagesDeleted?.length ?? 0,
      spaceReclaimed: result.SpaceReclaimed ?? 0,
    };
  }

  async listVolumes(): Promise<DockerVolumeInfo[]> {
    const [volRes, containers] = await Promise.all([
      this.docker.listVolumes(),
      this.listContainers(true),
    ]);

    const usage = new Map<string, { size: number; refCount: number }>();
    try {
      const df = await this.getSystemDf();
      for (const entry of df.Volumes ?? []) {
        if (!entry.Name) continue;
        usage.set(entry.Name, {
          size: entry.UsageData?.Size ?? 0,
          refCount: entry.UsageData?.RefCount ?? 0,
        });
      }
    } catch (error) {
      this.logger?.debug({ err: error }, 'docker df (volumes) failed');
    }

    const usedBy = new Map<string, string[]>();
    for (const row of containers) {
      const cname = row.name;
      for (const mountName of row.volumeMounts ?? []) {
        const list = usedBy.get(mountName) ?? [];
        if (!list.includes(cname)) list.push(cname);
        usedBy.set(mountName, list);
      }
    }

    return (volRes.Volumes ?? []).map((vol) => {
      const name = vol.Name;
      const stats = usage.get(name);
      const users = usedBy.get(name) ?? [];
      return {
        name,
        driver: vol.Driver ?? 'local',
        mountpoint: vol.Mountpoint ?? '',
        createdAt: (vol as { CreatedAt?: string }).CreatedAt ?? null,
        sizeBytes: stats ? stats.size : null,
        refCount: stats?.refCount ?? users.length,
        usedBy: users,
        labels: (vol.Labels ?? {}) as Record<string, string>,
      };
    });
  }

  async removeVolume(name: string, force = false): Promise<void> {
    assertSafeVolumeName(name);
    await this.docker.getVolume(name).remove({ force });
  }

  async pruneVolumes(): Promise<{ volumesDeleted: number; spaceReclaimed: number }> {
    const result = await this.docker.pruneVolumes();
    return {
      volumesDeleted: result.VolumesDeleted?.length ?? 0,
      spaceReclaimed: result.SpaceReclaimed ?? 0,
    };
  }

  async browseVolume(name: string): Promise<DockerVolumeBrowseEntry[]> {
    assertSafeVolumeName(name);
    await this.ensureHelperImage(VOLUME_HELPER_IMAGE);

    const container = await this.docker.createContainer({
      Image: VOLUME_HELPER_IMAGE,
      Tty: true,
      Cmd: [
        'sh',
        '-c',
        [
          'cd /data 2>/dev/null || exit 0',
          'ls -1A 2>/dev/null | head -n 100 | while IFS= read -r n; do',
          '  [ -n "$n" ] || continue',
          '  if [ -d "$n" ]; then t=d; else t=f; fi',
          '  s=$(du -sb "$n" 2>/dev/null | cut -f1)',
          '  printf "%s\\t%s\\t%s\\n" "$t" "${s:-0}" "$n"',
          'done',
        ].join('\n'),
      ],
      HostConfig: {
        AutoRemove: false,
        Binds: [`${name}:/data:ro`],
        NetworkMode: 'none',
      },
    });

    const timeout = setTimeout(() => {
      void container.kill().catch(() => undefined);
    }, 20_000);

    try {
      await container.start();
      await container.wait();
      const raw = await container.logs({ stdout: true, stderr: true });
      const text = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw);
      return parseVolumeBrowseOutput(text);
    } finally {
      clearTimeout(timeout);
      await container.remove({ force: true }).catch(() => undefined);
    }
  }

  private async ensureHelperImage(image: string): Promise<void> {
    try {
      await this.docker.getImage(image).inspect();
    } catch {
      await new Promise<void>((resolve, reject) => {
        this.docker.pull(image, (err: Error | null, stream: NodeJS.ReadableStream) => {
          if (err) {
            reject(err);
            return;
          }
          this.docker.modem.followProgress(stream, (followErr: Error | null) => {
            if (followErr) reject(followErr);
            else resolve();
          });
        });
      });
    }
  }

  async pruneBuildCache(): Promise<{ spaceReclaimed: number }> {
    // dockerode.pruneBuilder() ignores `all` and only clears unused cache.
    // Engine API: POST /build/prune?all=true ≈ `docker builder prune -af`
    type Modem = {
      dial: (
        opts: Record<string, unknown>,
        cb: (err: Error | null, data?: { SpaceReclaimed?: number }) => void,
      ) => void;
      Promise: PromiseConstructor;
    };
    const modem = (this.docker as unknown as { modem: Modem }).modem;
    const result = await new modem.Promise<{ SpaceReclaimed?: number }>((resolve, reject) => {
      modem.dial(
        {
          path: '/build/prune?all=true',
          method: 'POST',
          statusCodes: { 200: true, 500: 'server error' },
        },
        (err, data) => {
          if (err) reject(err);
          else resolve(data ?? {});
        },
      );
    });
    try {
      await this.docker.pruneImages({ filters: { dangling: ['true'] } });
    } catch {
      // dangling image prune is best-effort
    }
    return { spaceReclaimed: result.SpaceReclaimed ?? 0 };
  }

  async getBuildCacheBytes(): Promise<number> {
    try {
      const df = await this.getSystemDf();
      return (df.BuildCache ?? []).reduce((sum, entry) => sum + (entry.Size ?? 0), 0);
    } catch (error) {
      this.logger?.debug({ err: error }, 'docker df (build cache) failed');
      return 0;
    }
  }

  private async getSystemDf(): Promise<DockerSystemDf> {
    const now = Date.now();
    if (this.dfCache && now - this.dfCache.at < 45_000) {
      return this.dfCache.data;
    }
    if (this.dfInflight) return this.dfInflight;
    this.dfInflight = (async () => {
      try {
        const data = (await withTimeout(
          this.docker.df() as Promise<DockerSystemDf>,
          20_000,
          'Docker df timeout',
        )) as DockerSystemDf;
        this.dfCache = { at: Date.now(), data };
        return data;
      } finally {
        this.dfInflight = null;
      }
    })();
    return this.dfInflight;
  }

  async getImageInspect(
    id: string,
  ): Promise<{ Id: string; RepoDigests?: string[]; RepoTags?: string[] }> {
    const image = this.docker.getImage(id);
    const info = await image.inspect();
    return {
      Id: info.Id,
      RepoDigests: info.RepoDigests,
      RepoTags: info.RepoTags,
    };
  }

  getRecentEvents(limit = 20): DockerEventInfo[] {
    return this.events.slice(0, Math.max(0, limit));
  }

  startEventListener(): void {
    if (this.listening) return;
    this.listening = true;

    void this.attachEventStream();
  }

  stopEventListener(): void {
    this.listening = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.stream && 'destroy' in this.stream) {
      (this.stream as NodeJS.ReadableStream & { destroy: () => void }).destroy();
    }
    this.stream = null;
  }

  private async attachEventStream(): Promise<void> {
    try {
      const stream = (await this.docker.getEvents({
        filters: { type: ['container', 'image', 'volume'] },
      })) as NodeJS.ReadableStream;

      this.stream = stream;
      let buffer = '';

      stream.on('data', (chunk: Buffer | string) => {
        buffer += chunk.toString();
        if (buffer.length > 1_048_576) {
          buffer = buffer.slice(-256_000);
        }
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const raw = JSON.parse(line) as DockerRawEvent;
            const mapped = mapDockerEvent(raw);
            if (mapped) {
              this.events.unshift(mapped);
              if (this.events.length > this.maxEvents) {
                this.events.length = this.maxEvents;
              }
              this.handleResourceEvent(mapped.type, mapped.action);
            }
          } catch (error) {
            this.logger?.debug({ err: error, line }, 'Failed to parse Docker event');
          }
        }
      });

      stream.on('error', (error) => {
        this.logger?.warn({ err: error }, 'Docker event stream error');
        this.scheduleReconnect();
      });

      stream.on('end', () => {
        this.logger?.info('Docker event stream ended');
        this.scheduleReconnect();
      });
    } catch (error) {
      this.logger?.warn({ err: error }, 'Could not attach Docker event stream');
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    this.stream = null;
    if (!this.listening) return;
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.listening && !this.stream) {
        void this.attachEventStream();
      }
    }, 5_000);
  }

  subscribeResourceChanges(listener: (event: DockerResourceChange) => void): () => void {
    this.resourceListeners.add(listener);
    return () => {
      this.resourceListeners.delete(listener);
    };
  }

  private handleResourceEvent(type: string, action: string): void {
    if (isNoisyDockerAction(action)) return;
    if (type === 'container' || type === 'network' || type === 'volume') {
      this.invalidateListCache();
    }
    if (type === 'image' || type === 'container') {
      this.imageCache = null;
    }
    if (type === 'volume') {
      this.dfCache = null;
    }
    const event: DockerResourceChange = { type, action };
    for (const listener of this.resourceListeners) {
      try {
        listener(event);
      } catch {
        // ignore subscriber errors
      }
    }
  }
}

/** Null-Object wenn kein Socket vorhanden */
export class OfflineDockerClient implements IDockerClient {
  private static offline(): never {
    throw new Error('Docker is offline');
  }

  getRaw(): unknown {
    OfflineDockerClient.offline();
  }

  async ping(): Promise<boolean> {
    return false;
  }

  async getVersion(): Promise<DockerVersionInfo> {
    OfflineDockerClient.offline();
  }

  async listContainers(): Promise<DockerContainerInfo[]> {
    return [];
  }

  async inspectContainer(_id: string): Promise<DockerContainerDetails> {
    OfflineDockerClient.offline();
  }

  async containerAction(
    _id: string,
    _action: 'start' | 'stop' | 'restart' | 'kill' | 'pause' | 'unpause' | 'remove',
  ): Promise<void> {
    OfflineDockerClient.offline();
  }

  async getContainerLogs(_id: string): Promise<string> {
    OfflineDockerClient.offline();
  }

  async streamContainerLogs(
    _id: string,
    _onData: (chunk: string) => void,
  ): Promise<{ close: () => void }> {
    OfflineDockerClient.offline();
  }

  async getContainerStats(_id: string): Promise<DockerStatsSnapshot> {
    OfflineDockerClient.offline();
  }

  async listImages(): Promise<DockerImageInfo[]> {
    return [];
  }

  async pullImage(_image: string): Promise<void> {
    OfflineDockerClient.offline();
  }

  async tagImage(_source: string, _target: string): Promise<void> {
    OfflineDockerClient.offline();
  }

  async removeImage(_id: string): Promise<void> {
    OfflineDockerClient.offline();
  }

  async pruneImages(): Promise<{ imagesDeleted: number; spaceReclaimed: number }> {
    OfflineDockerClient.offline();
  }

  async listVolumes(): Promise<DockerVolumeInfo[]> {
    return [];
  }

  async removeVolume(_name: string): Promise<void> {
    OfflineDockerClient.offline();
  }

  async pruneVolumes(): Promise<{ volumesDeleted: number; spaceReclaimed: number }> {
    OfflineDockerClient.offline();
  }

  async browseVolume(_name: string): Promise<DockerVolumeBrowseEntry[]> {
    OfflineDockerClient.offline();
  }

  async pruneBuildCache(): Promise<{ spaceReclaimed: number }> {
    OfflineDockerClient.offline();
  }

  async getBuildCacheBytes(): Promise<number> {
    return 0;
  }

  async getImageInspect(_id: string): Promise<{ Id: string; RepoDigests?: string[]; RepoTags?: string[] }> {
    OfflineDockerClient.offline();
  }

  getRecentEvents(): DockerEventInfo[] {
    return [];
  }

  startEventListener(): void {
    // no-op
  }

  stopEventListener(): void {
    // no-op
  }

  subscribeResourceChanges(_listener: (event: DockerResourceChange) => void): () => void {
    return () => undefined;
  }
}

/** Factory: prüft Socket-Existenz, liefert Client (auch wenn Daemon offline). */
/** Factory: immer DockerodeClient – fehlt der Socket beim Start, verbindet er später nach. */
export function createDockerClient(
  socketPath: string,
  logger?: FastifyBaseLogger,
): IDockerClient {
  if (!existsSync(socketPath)) {
    logger?.warn(
      { socketPath },
      'Docker socket not found at startup – will retry when the daemon becomes available',
    );
  }
  return new DockerodeClient({ socketPath, logger });
}


interface DockerRawEvent {
  Type?: string;
  Action?: string;
  time?: number;
  timeNano?: number;
  Actor?: {
    ID?: string;
    Attributes?: Record<string, string>;
  };
  status?: string;
  id?: string;
  from?: string;
}

type ListContainerRow = Awaited<ReturnType<Docker['listContainers']>>[number];
type InspectContainerInfo = Awaited<
  ReturnType<ReturnType<Docker['getContainer']>['inspect']>
>;
type RawImageInfo = Awaited<ReturnType<Docker['listImages']>>[number];
type RawContainerStats = Dockerode.ContainerStats;

function mapListContainer(c: ListContainerRow): DockerContainerInfo {
  const name = (c.Names?.[0] ?? c.Id.slice(0, 12)).replace(/^\//, '');
  const status = mapContainerStatus(c.State);
  const health = parseHealthFromStatus(c.Status);

  return {
    id: c.Id,
    name,
    image: c.Image,
    imageId: c.ImageID,
    status,
    state: c.Status ?? c.State ?? 'unknown',
    createdAt: new Date((c.Created ?? 0) * 1000).toISOString(),
    health,
    labels: c.Labels ?? {},
    ports: formatPorts(c.Ports),
    networks: Object.keys(c.NetworkSettings?.Networks ?? {}),
    volumeMounts: (c.Mounts ?? [])
      .filter((m) => m.Type === 'volume' && Boolean(m.Name))
      .map((m) => m.Name as string),
    composeProject: c.Labels?.[COMPOSE_PROJECT_LABEL],
    composeService: c.Labels?.[COMPOSE_SERVICE_LABEL],
  };
}

function mapInspectContainer(info: InspectContainerInfo): DockerContainerDetails {
  const name = (info.Name ?? info.Id.slice(0, 12)).replace(/^\//, '');
  const status = mapContainerStatus(info.State?.Status);
  const health = parseHealthFromInspect(info.State?.Health?.Status);

  return {
    id: info.Id,
    name,
    image: info.Config?.Image ?? 'unknown',
    imageId: info.Image,
    status,
    state: info.State?.Status ?? 'unknown',
    createdAt: info.Created,
    startedAt: info.State?.StartedAt || undefined,
    health,
    exitCode: info.State?.ExitCode,
    labels: info.Config?.Labels ?? {},
    ports: formatInspectPorts(info.NetworkSettings?.Ports),
    networks: Object.keys(info.NetworkSettings?.Networks ?? {}),
    volumeMounts: (info.Mounts ?? [])
      .filter((m) => m.Type === 'volume' && Boolean(m.Name))
      .map((m) => m.Name as string),
    composeProject: info.Config?.Labels?.[COMPOSE_PROJECT_LABEL],
    composeService: info.Config?.Labels?.[COMPOSE_SERVICE_LABEL],
    env: info.Config?.Env ?? [],
    mounts: (info.Mounts ?? []).map((m) => ({
      source: m.Source,
      destination: m.Destination,
      mode: m.Mode,
      type: m.Type,
    })),
    networkMode: info.HostConfig?.NetworkMode,
    restartPolicy: info.HostConfig?.RestartPolicy?.Name,
    command: formatCommand(info.Config?.Cmd, info.Config?.Entrypoint),
    platform: info.Platform,
    sizeRw: readOptionalNumber(info, 'SizeRw'),
    sizeRootFs: readOptionalNumber(info, 'SizeRootFs'),
  };
}

function mapImageInfo(img: RawImageInfo): DockerImageInfo {
  const tags = (img.RepoTags ?? []).filter((tag) => tag !== '<none>:<none>');
  const dangling =
    tags.length === 0 ||
    (img.RepoTags ?? []).every((tag) => tag.startsWith('<none>'));

  return {
    id: img.Id,
    tags,
    size: img.Size,
    createdAt: new Date((img.Created ?? 0) * 1000).toISOString(),
    dangling,
    digests: img.RepoDigests ?? [],
  };
}

function mapContainerStats(stats: RawContainerStats): DockerStatsSnapshot {
  const cpuDelta =
    stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
  const systemDelta =
    stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
  const onlineCpus = stats.cpu_stats.online_cpus ?? 1;
  const cpuPercent =
    systemDelta > 0 && cpuDelta > 0
      ? round2((cpuDelta / systemDelta) * onlineCpus * 100)
      : 0;

  const memoryUsageBytes = stats.memory_stats.usage ?? 0;
  const memoryLimitBytes = stats.memory_stats.limit ?? 0;
  const memoryPercent =
    memoryLimitBytes > 0 ? round2((memoryUsageBytes / memoryLimitBytes) * 100) : 0;

  let netRxBytes = 0;
  let netTxBytes = 0;
  for (const network of Object.values(stats.networks ?? {})) {
    netRxBytes += network?.rx_bytes ?? 0;
    netTxBytes += network?.tx_bytes ?? 0;
  }

  let blockReadBytes = 0;
  let blockWriteBytes = 0;
  for (const entry of stats.blkio_stats?.io_service_bytes_recursive ?? []) {
    const op = (entry.op ?? '').toLowerCase();
    if (op === 'read') {
      blockReadBytes += entry.value ?? 0;
    } else if (op === 'write') {
      blockWriteBytes += entry.value ?? 0;
    }
  }

  return {
    cpuPercent,
    memoryUsageBytes,
    memoryLimitBytes,
    memoryPercent,
    netRxBytes,
    netTxBytes,
    blockReadBytes,
    blockWriteBytes,
    timestamp: stats.read ?? new Date().toISOString(),
  };
}

function mapDockerEvent(raw: DockerRawEvent): DockerEventInfo | null {
  const action = raw.Action ?? raw.status ?? 'unknown';
  const containerId = raw.Actor?.ID ?? raw.id;
  const containerName = raw.Actor?.Attributes?.name;
  const ts =
    typeof raw.time === 'number'
      ? new Date(raw.time * 1000).toISOString()
      : new Date().toISOString();

  const kind = raw.Type ?? 'container';
  const name = containerName ?? containerId?.slice(0, 12) ?? 'unknown';

  return {
    id: `${containerId ?? 'evt'}-${raw.timeNano ?? raw.time ?? Date.now()}-${action}`,
    type: kind,
    action,
    message: `${kind} ${name}: ${action}`,
    timestamp: ts,
    containerId,
    containerName,
  };
}

function parseHealthFromStatus(
  statusText: string | undefined,
): 'healthy' | 'unhealthy' | 'starting' | 'none' {
  if (!statusText) return 'none';
  const lower = statusText.toLowerCase();
  if (lower.includes('(unhealthy)')) return 'unhealthy';
  if (lower.includes('(healthy)')) return 'healthy';
  if (lower.includes('(health: starting)')) return 'starting';
  return 'none';
}

function parseHealthFromInspect(
  status: string | undefined,
): 'healthy' | 'unhealthy' | 'starting' | 'none' {
  switch (status?.toLowerCase()) {
    case 'healthy':
      return 'healthy';
    case 'unhealthy':
      return 'unhealthy';
    case 'starting':
      return 'starting';
    default:
      return 'none';
  }
}

function formatInspectPorts(
  ports: Record<string, Array<{ HostIp: string; HostPort: string }> | null> | undefined,
): string[] {
  if (!ports) return [];

  return Object.entries(ports).flatMap(([key, bindings]) => {
    const [privatePort, proto = 'tcp'] = key.split('/');
    if (!bindings || bindings.length === 0) {
      return [`${privatePort}/${proto}`];
    }

    return bindings.map((binding) => {
      const ip = binding.HostIp && binding.HostIp !== '0.0.0.0' ? `${binding.HostIp}:` : '';
      return `${ip}${binding.HostPort}->${privatePort}/${proto}`;
    });
  });
}

function formatCommand(
  cmd: string[] | undefined,
  entrypoint: string | string[] | undefined,
): string | undefined {
  const parts = [
    ...(Array.isArray(entrypoint) ? entrypoint : entrypoint ? [entrypoint] : []),
    ...(cmd ?? []),
  ];
  return parts.length > 0 ? parts.join(' ') : undefined;
}

function readOptionalNumber(source: object, key: string): number | undefined {
  const value = (source as Record<string, unknown>)[key];
  return typeof value === 'number' ? value : undefined;
}

/** Split `repo:tag` or `host/repo:tag` for dockerode Image.tag(). */
export function splitRepoTag(target: string): { repo: string; tag: string } {
  const withoutDigest = target.split('@')[0] ?? target;
  const lastSlash = withoutDigest.lastIndexOf('/');
  const lastColon = withoutDigest.lastIndexOf(':');
  if (lastColon > lastSlash) {
    return {
      repo: withoutDigest.slice(0, lastColon),
      tag: withoutDigest.slice(lastColon + 1) || 'latest',
    };
  }
  return { repo: withoutDigest, tag: 'latest' };
}

async function demuxDockerOutput(
  modem: DemuxModem,
  data: Buffer | NodeJS.ReadableStream,
): Promise<string> {
  const chunks: string[] = [];
  const stdout = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(chunk.toString());
      callback();
    },
  });
  const stderr = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(chunk.toString());
      callback();
    },
  });

  const stream = Buffer.isBuffer(data) ? Readable.from(data) : data;

  return new Promise((resolve, reject) => {
    stream.on('error', reject);
    stream.on('end', () => resolve(chunks.join('')));
    modem.demuxStream(stream, stdout, stderr);
  });
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function assertSafeVolumeName(name: string): void {
  if (!VOLUME_NAME_RE.test(name)) {
    throw new Error('Invalid volume name');
  }
}

export function parseVolumeBrowseOutput(text: string): DockerVolumeBrowseEntry[] {
  const entries: DockerVolumeBrowseEntry[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.replace(/^\u0001|\u0002/g, '').trimEnd();
    if (!trimmed.trim()) continue;
    const [kindRaw, sizeRaw, ...nameParts] = trimmed.split('\t');
    const name = nameParts.join('\t').trim();
    if (!name || name === '.' || name === '..') continue;
    if (name.includes('/') || name.includes('\\')) continue;
    const kind = kindRaw === 'd' ? 'dir' : 'file';
    const size = Number.parseInt(sizeRaw ?? '', 10);
    entries.push({
      name,
      kind,
      sizeBytes: Number.isFinite(size) ? size : null,
    });
  }
  return entries;
}
