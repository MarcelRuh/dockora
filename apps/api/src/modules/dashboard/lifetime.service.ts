import type { LifetimeStatsSnapshot } from '@dockora/shared';
import { prisma } from '../../infrastructure/db/prisma.js';
import { dockerActionName } from '../../infrastructure/docker/resource-events.js';

const LIFETIME_ID = 'default';

export interface LifetimeSample {
  cpuPercent: number | null;
  memoryPercent: number | null;
  diskPercent: number | null;
  containerCount: number;
}

export interface LifetimeRow {
  trackingSince: Date;
  samplesCount: number;
  peakCpuPercent: number;
  peakMemoryPercent: number;
  peakDiskPercent: number;
  sumCpuPercent: number;
  sumMemoryPercent: number;
  sumDiskPercent: number;
  containerStarts: number;
  containerStops: number;
  containerDies: number;
  containerRestarts: number;
  maxContainersSeen: number;
  lastSampleAt: Date | null;
}

export function emptyLifetimeRow(now = new Date()): LifetimeRow {
  return {
    trackingSince: now,
    samplesCount: 0,
    peakCpuPercent: 0,
    peakMemoryPercent: 0,
    peakDiskPercent: 0,
    sumCpuPercent: 0,
    sumMemoryPercent: 0,
    sumDiskPercent: 0,
    containerStarts: 0,
    containerStops: 0,
    containerDies: 0,
    containerRestarts: 0,
    maxContainersSeen: 0,
    lastSampleAt: null,
  };
}

export function applyLifetimeSample(row: LifetimeRow, sample: LifetimeSample, now = new Date()): LifetimeRow {
  const cpu = sample.cpuPercent;
  const mem = sample.memoryPercent;
  const disk = sample.diskPercent;
  const hasMetric = cpu != null || mem != null || disk != null;

  return {
    ...row,
    samplesCount: hasMetric ? row.samplesCount + 1 : row.samplesCount,
    peakCpuPercent: cpu != null ? Math.max(row.peakCpuPercent, cpu) : row.peakCpuPercent,
    peakMemoryPercent: mem != null ? Math.max(row.peakMemoryPercent, mem) : row.peakMemoryPercent,
    peakDiskPercent: disk != null ? Math.max(row.peakDiskPercent, disk) : row.peakDiskPercent,
    sumCpuPercent: cpu != null ? row.sumCpuPercent + cpu : row.sumCpuPercent,
    sumMemoryPercent: mem != null ? row.sumMemoryPercent + mem : row.sumMemoryPercent,
    sumDiskPercent: disk != null ? row.sumDiskPercent + disk : row.sumDiskPercent,
    maxContainersSeen: Math.max(row.maxContainersSeen, Math.max(0, sample.containerCount)),
    lastSampleAt: now,
  };
}

export function lifetimeEventCounter(
  type: string,
  action: string,
): 'containerStarts' | 'containerStops' | 'containerDies' | 'containerRestarts' | null {
  if (type !== 'container') return null;
  switch (dockerActionName(action)) {
    case 'start':
      return 'containerStarts';
    case 'stop':
      return 'containerStops';
    case 'die':
    case 'oom':
      return 'containerDies';
    case 'restart':
      return 'containerRestarts';
    default:
      return null;
  }
}

export function toLifetimeSnapshot(row: LifetimeRow): LifetimeStatsSnapshot {
  const n = row.samplesCount;
  const avg = (sum: number) => (n > 0 ? Math.round((sum / n) * 10) / 10 : 0);
  return {
    trackingSince: row.trackingSince.toISOString(),
    samplesCount: row.samplesCount,
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

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function mapRow(row: {
  trackingSince: Date;
  samplesCount: number;
  peakCpuPercent: number;
  peakMemoryPercent: number;
  peakDiskPercent: number;
  sumCpuPercent: number;
  sumMemoryPercent: number;
  sumDiskPercent: number;
  containerStarts: number;
  containerStops: number;
  containerDies: number;
  containerRestarts: number;
  maxContainersSeen: number;
  lastSampleAt: Date | null;
}): LifetimeRow {
  return {
    trackingSince: row.trackingSince,
    samplesCount: row.samplesCount,
    peakCpuPercent: row.peakCpuPercent,
    peakMemoryPercent: row.peakMemoryPercent,
    peakDiskPercent: row.peakDiskPercent,
    sumCpuPercent: row.sumCpuPercent,
    sumMemoryPercent: row.sumMemoryPercent,
    sumDiskPercent: row.sumDiskPercent,
    containerStarts: row.containerStarts,
    containerStops: row.containerStops,
    containerDies: row.containerDies,
    containerRestarts: row.containerRestarts,
    maxContainersSeen: row.maxContainersSeen,
    lastSampleAt: row.lastSampleAt,
  };
}

export class LifetimeStatsService {
  async getSnapshot(): Promise<LifetimeStatsSnapshot> {
    const row = await this.ensureRow();
    return toLifetimeSnapshot(mapRow(row));
  }

  async recordSample(sample: LifetimeSample): Promise<void> {
    const current = await this.ensureRow();
    const next = applyLifetimeSample(mapRow(current), sample);
    await prisma.lifetimeStats.update({
      where: { id: LIFETIME_ID },
      data: {
        samplesCount: next.samplesCount,
        peakCpuPercent: next.peakCpuPercent,
        peakMemoryPercent: next.peakMemoryPercent,
        peakDiskPercent: next.peakDiskPercent,
        sumCpuPercent: next.sumCpuPercent,
        sumMemoryPercent: next.sumMemoryPercent,
        sumDiskPercent: next.sumDiskPercent,
        maxContainersSeen: next.maxContainersSeen,
        lastSampleAt: next.lastSampleAt,
      },
    });
  }

  async recordContainerEvent(event: { type: string; action: string }): Promise<void> {
    const field = lifetimeEventCounter(event.type, event.action);
    if (!field) return;
    await this.ensureRow();
    await prisma.lifetimeStats.update({
      where: { id: LIFETIME_ID },
      data: { [field]: { increment: 1 } },
    });
  }

  private async ensureRow() {
    const existing = await prisma.lifetimeStats.findUnique({ where: { id: LIFETIME_ID } });
    if (existing) return existing;
    return prisma.lifetimeStats.create({
      data: { id: LIFETIME_ID },
    });
  }
}

export const lifetimeStatsService = new LifetimeStatsService();
