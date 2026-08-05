import os from 'node:os';
import fs from 'node:fs/promises';
import type { HostResources, IHostMetrics } from '../../domain/ports.js';

interface CpuSample {
  idle: number;
  total: number;
}

/**
 * Host-Ressourcen (CPU/RAM/Disk) – unabhängig von Docker.
 * CPU wird über zwei /proc/stat-Samples (Linux) oder loadavg-Fallback gemessen.
 */
export class HostMetricsService implements IHostMetrics {
  constructor(private readonly sampleDelayMs = 200) {}

  async getResources(diskPath = '/'): Promise<HostResources> {
    const memoryTotalBytes = os.totalmem();
    const memoryUsedBytes = memoryTotalBytes - os.freemem();
    const cpuPercent = await this.measureCpuPercent();
    const disk = await this.measureDisk(diskPath);
    const temperatureC = await this.readTemperatureC();

    return {
      cpuPercent,
      memoryUsedBytes,
      memoryTotalBytes,
      diskUsedBytes: disk?.used ?? null,
      diskTotalBytes: disk?.total ?? null,
      diskPath,
      temperatureC,
    };
  }

  private async measureCpuPercent(): Promise<number | null> {
    if (process.platform === 'linux') {
      const first = await this.readProcStat();
      if (!first) return this.loadAvgFallback();
      await sleep(this.sampleDelayMs);
      const second = await this.readProcStat();
      if (!second) return this.loadAvgFallback();

      const idleDelta = second.idle - first.idle;
      const totalDelta = second.total - first.total;
      if (totalDelta <= 0) return 0;
      const usage = (1 - idleDelta / totalDelta) * 100;
      return round1(clamp(usage, 0, 100));
    }

    return this.loadAvgFallback();
  }

  private loadAvgFallback(): number {
    const load = os.loadavg()[0] ?? 0;
    const cores = Math.max(os.cpus().length, 1);
    return round1(clamp((load / cores) * 100, 0, 100));
  }

  private async readProcStat(): Promise<CpuSample | null> {
    try {
      const content = await fs.readFile('/proc/stat', 'utf8');
      const line = content.split('\n').find((l) => l.startsWith('cpu '));
      if (!line) return null;
      const parts = line.trim().split(/\s+/).slice(1).map(Number);
      if (parts.length < 4 || parts.some((n) => Number.isNaN(n))) return null;

      const idle = (parts[3] ?? 0) + (parts[4] ?? 0); // idle + iowait
      const total = parts.reduce((a, b) => a + b, 0);
      return { idle, total };
    } catch {
      return null;
    }
  }

  private async readTemperatureC(): Promise<number | null> {
    if (process.platform !== 'linux') {
      return null;
    }

    try {
      const zones = await fs.readdir('/sys/class/thermal');
      const readings: number[] = [];

      for (const zone of zones) {
        if (!zone.startsWith('thermal_zone')) {
          continue;
        }

        try {
          const raw = await fs.readFile(`/sys/class/thermal/${zone}/temp`, 'utf8');
          const milliC = Number.parseInt(raw.trim(), 10);
          if (!Number.isNaN(milliC)) {
            readings.push(milliC / 1000);
          }
        } catch {
          // Einzelne Zone ignorieren
        }
      }

      if (readings.length === 0) {
        return null;
      }

      return round1(Math.max(...readings));
    } catch {
      return null;
    }
  }

  private async measureDisk(
    path: string,
  ): Promise<{ used: number; total: number } | null> {
    try {
      const stats = await fs.statfs(path);
      const total = Number(stats.blocks) * Number(stats.bsize);
      const free = Number(stats.bavail) * Number(stats.bsize);
      const used = total - free;
      return { used, total };
    } catch {
      return null;
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
