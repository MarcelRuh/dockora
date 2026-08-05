import type { DashboardOverview } from '@dockora/shared';
import { prisma } from '../db/prisma.js';
import type { IDockerClient, IHostMetrics } from '../../domain/ports.js';

export type LifetimeSnapshot = NonNullable<DashboardOverview['lifetime']>;

/**
 * Persistente Lifetime-Statistiken: Peaks, Durchschnitte, Event-Zähler.
 */
export class LifetimeStatsService {
  private processedEventIds = new Set<string>();
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly docker: IDockerClient,
    private readonly hostMetrics: IHostMetrics,
  ) {}

  start(intervalMs = 15_000): void {
    if (this.timer) return;
    void this.ensureRow();
    void this.tick();
    this.timer = setInterval(() => void this.tick(), intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async getSnapshot(): Promise<LifetimeSnapshot> {
    const row = await this.ensureRow();
    const samples = Math.max(row.samplesCount, 0);
    const avg = (sum: number) => (samples > 0 ? Math.round((sum / samples) * 10) / 10 : null);

    return {
      trackingSince: row.trackingSince.toISOString(),
      samplesCount: samples,
      peakCpuPercent: round1(row.peakCpuPercent),
      peakMemoryPercent: round1(row.peakMemoryPercent),
      peakDiskPercent: round1(row.peakDiskPercent),
      avgCpuPercent: avg(row.sumCpuPercent),
      avgMemoryPercent: avg(row.sumMemoryPercent),
      avgDiskPercent: avg(row.sumDiskPercent),
      containerStarts: row.containerStarts,
      containerStops: row.containerStops,
      containerDies: row.containerDies,
      containerRestarts: row.containerRestarts,
      maxContainersSeen: row.maxContainersSeen,
      lastSampleAt: row.lastSampleAt?.toISOString() ?? null,
    };
  }

  private async ensureRow() {
    return prisma.lifetimeStats.upsert({
      where: { id: 'default' },
      create: { id: 'default' },
      update: {},
    });
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await Promise.all([this.sampleHost(), this.ingestEvents(), this.sampleContainers()]);
    } catch {
      // Lifetime-Tracking darf die App nicht crashen
    } finally {
      this.running = false;
    }
  }

  private async sampleHost(): Promise<void> {
    const resources = await this.hostMetrics.getResources('/');
    const cpu = resources.cpuPercent ?? 0;
    const mem =
      resources.memoryTotalBytes > 0
        ? (resources.memoryUsedBytes / resources.memoryTotalBytes) * 100
        : 0;
    const disk =
      resources.diskTotalBytes && resources.diskTotalBytes > 0 && resources.diskUsedBytes != null
        ? (resources.diskUsedBytes / resources.diskTotalBytes) * 100
        : 0;

    const row = await this.ensureRow();
    await prisma.lifetimeStats.update({
      where: { id: 'default' },
      data: {
        samplesCount: { increment: 1 },
        peakCpuPercent: Math.max(row.peakCpuPercent, cpu),
        peakMemoryPercent: Math.max(row.peakMemoryPercent, mem),
        peakDiskPercent: Math.max(row.peakDiskPercent, disk),
        sumCpuPercent: { increment: cpu },
        sumMemoryPercent: { increment: mem },
        sumDiskPercent: { increment: disk },
        lastSampleAt: new Date(),
      },
    });
  }

  private async sampleContainers(): Promise<void> {
    try {
      const list = await this.docker.listContainers(true);
      const count = list.length;
      const row = await this.ensureRow();
      if (count > row.maxContainersSeen) {
        await prisma.lifetimeStats.update({
          where: { id: 'default' },
          data: { maxContainersSeen: count },
        });
      }
    } catch {
      // offline
    }
  }

  private async ingestEvents(): Promise<void> {
    const events = this.docker.getRecentEvents(50);
    let starts = 0;
    let stops = 0;
    let dies = 0;
    let restarts = 0;

    for (const event of events) {
      if (this.processedEventIds.has(event.id)) continue;
      this.processedEventIds.add(event.id);

      const action = event.action.toLowerCase();
      if (action === 'start') starts += 1;
      else if (action === 'stop' || action === 'kill') stops += 1;
      else if (action === 'die' || action === 'oom') dies += 1;
      else if (action === 'restart') restarts += 1;
    }

    // Cap memory of processed ids
    if (this.processedEventIds.size > 500) {
      const keep = [...this.processedEventIds].slice(-200);
      this.processedEventIds = new Set(keep);
    }

    if (starts + stops + dies + restarts === 0) return;

    await prisma.lifetimeStats.update({
      where: { id: 'default' },
      data: {
        containerStarts: starts ? { increment: starts } : undefined,
        containerStops: stops ? { increment: stops } : undefined,
        containerDies: dies ? { increment: dies } : undefined,
        containerRestarts: restarts ? { increment: restarts } : undefined,
      },
    });
  }
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
