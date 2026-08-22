import { describe, expect, it, vi } from 'vitest';
import type {
  IComposeVersionProvider,
  IDockerClient,
  IHostMetrics,
} from '../../domain/ports.js';
import { DashboardService } from './dashboard.service.js';

function createMocks(overrides?: {
  ping?: boolean;
  containers?: Awaited<ReturnType<IDockerClient['listContainers']>>;
}) {
  const docker: IDockerClient = {
    ping: vi.fn().mockResolvedValue(overrides?.ping ?? true),
    getVersion: vi.fn().mockResolvedValue({
      version: '27.0.0',
      apiVersion: '1.46',
    }),
    listContainers: vi.fn().mockResolvedValue(
      overrides?.containers ?? [
        {
          id: 'a',
          name: 'web',
          image: 'nginx:latest',
          status: 'running',
          state: 'Up 2 hours',
          createdAt: new Date().toISOString(),
          health: 'healthy',
          labels: {},
          ports: ['80/tcp'],
          networks: [],
        },
        {
          id: 'b',
          name: 'db',
          image: 'postgres:16',
          status: 'exited',
          state: 'Exited (0)',
          createdAt: new Date().toISOString(),
          exitCode: 0,
          labels: {},
          ports: [],
          networks: [],
        },
      ],
    ),
    inspectContainer: vi.fn(),
    containerAction: vi.fn(),
    getContainerLogs: vi.fn(),
    streamContainerLogs: vi.fn(),
    getContainerStats: vi.fn(),
    listImages: vi.fn(),
    pullImage: vi.fn(),
    removeImage: vi.fn(),
    pruneImages: vi.fn(),
    tagImage: vi.fn(),
    pruneBuildCache: vi.fn(async () => ({ spaceReclaimed: 0 })),
    getBuildCacheBytes: vi.fn(async () => 0),
    getImageInspect: vi.fn(),
    getRaw: vi.fn(),
    getRecentEvents: vi.fn().mockReturnValue([
      {
        id: 'evt-1',
        type: 'container',
        action: 'start',
        message: 'Container web: start',
        timestamp: '2026-08-05T12:00:00.000Z',
        containerId: 'a',
        containerName: 'web',
      },
    ]),
    startEventListener: vi.fn(),
    stopEventListener: vi.fn(),
  };

  const hostMetrics: IHostMetrics = {
    getResources: vi.fn().mockResolvedValue({
      cpuPercent: 12.5,
      cpuCores: 8,
      memoryUsedBytes: 4_000_000_000,
      memoryTotalBytes: 8_000_000_000,
      diskUsedBytes: 50_000_000_000,
      diskTotalBytes: 100_000_000_000,
      diskPath: '/',
      temperatureC: null,
    }),
  };

  const composeVersion: IComposeVersionProvider = {
    getVersion: vi.fn().mockResolvedValue('2.29.0'),
  };

  return { docker, hostMetrics, composeVersion };
}

describe('DashboardService', () => {
  it('returns aggregated overview when Docker is online', async () => {
    const mocks = createMocks();
    const service = new DashboardService(mocks);
    const overview = await service.getOverview();

    expect(overview.docker.engineStatus).toBe('online');
    expect(overview.docker.engineVersion).toBe('27.0.0');
    expect(overview.docker.composeVersion).toBe('2.29.0');
    expect(overview.containers).toEqual({
      total: 2,
      running: 1,
      stopped: 1,
      unhealthy: 0,
    });
    expect(overview.resources.cpuPercent).toBe(12.5);
    expect(overview.recentEvents).toHaveLength(1);
    expect(overview.updatesAvailable).toBe(0);
  });

  it('marks engine offline when ping fails', async () => {
    const mocks = createMocks({ ping: false });
    const service = new DashboardService(mocks);
    const overview = await service.getOverview();

    expect(overview.docker.engineStatus).toBe('offline');
    expect(overview.docker.engineVersion).toBeNull();
  });
});
