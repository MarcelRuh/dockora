import os from 'node:os';
import fs from 'node:fs/promises';
import type { HostResources, IHostMetrics } from '../../domain/ports.js';

interface CpuSample {
  idle: number;
  total: number;
}

interface MemorySample {
  usedBytes: number;
  totalBytes: number;
}

/**
 * Host-/Gast-Ressourcen (CPU/RAM/Disk).
 *
 * Docker-in-LXC: `/proc/meminfo` im Container zeigt oft den Hypervisor.
 * Bind-Mounts von `/proc/*` sind unzuverlässig (falsche MemAvailable).
 * Daher bevorzugt: Snap-Datei vom Host-Agent (`nsenter` → `/data/host-proc.snap`).
 */
export class HostMetricsService implements IHostMetrics {
  private lastCpuSample: CpuSample | null = null;

  constructor(
    private readonly sampleDelayMs = 200,
    private readonly snapPath = process.env.DOCKORA_HOST_PROC_SNAP?.trim() || '/data/host-proc.snap',
    private readonly procRoots: string[] = defaultProcRoots(),
  ) {}

  async getResources(diskPath = '/'): Promise<HostResources> {
    const snap = await readHostProcSnap(this.snapPath);

    const memory =
      (snap ? parseMeminfo(snap.meminfo) : null) ??
      (await readCgroupMemory()) ??
      (await this.readMemoryFromProcRoots()) ??
      fallbackOsMemory();

    const cpuPercent = snap?.stat
      ? this.cpuPercentFromSample(parseProcStat(snap.stat))
      : await this.measureCpuPercent();

    const cpuCores =
      (snap?.stat ? countCpuCores(snap.stat) : null) ??
      (await this.readCpuCoresFromProc()) ??
      Math.max(os.cpus().length, 1);

    const disk =
      (snap?.df ? parseDfLine(snap.df) : null) ?? (await this.measureDisk(diskPath));

    const temperatureC = await this.readTemperatureC();

    return {
      cpuPercent,
      cpuCores,
      memoryUsedBytes: memory.usedBytes,
      memoryTotalBytes: memory.totalBytes,
      diskUsedBytes: disk?.used ?? null,
      diskTotalBytes: disk?.total ?? null,
      diskPath,
      temperatureC,
    };
  }

  private async readCpuCoresFromProc(): Promise<number | null> {
    for (const root of this.procRoots) {
      try {
        const content = await fs.readFile(`${root}/stat`, 'utf8');
        const cores = countCpuCores(content);
        if (cores !== null) return cores;
      } catch {
        // try next
      }
    }
    return null;
  }

  private async readMemoryFromProcRoots(): Promise<MemorySample | null> {
    for (const root of this.procRoots) {
      if (root !== '/proc') continue;
      const fromProc = await readMeminfoFile(`${root}/meminfo`);
      if (fromProc) return fromProc;
    }
    return null;
  }

  /** CPU-% aus aufeinanderfolgenden Polls (Monitoring/SSE). */
  private cpuPercentFromSample(sample: CpuSample | null): number | null {
    if (!sample) return this.loadAvgFallback();
    const prev = this.lastCpuSample;
    this.lastCpuSample = sample;
    if (!prev) return this.loadAvgFallback();

    const idleDelta = sample.idle - prev.idle;
    const totalDelta = sample.total - prev.total;
    if (totalDelta <= 0) return 0;
    return round1(clamp((1 - idleDelta / totalDelta) * 100, 0, 100));
  }

  private async measureCpuPercent(): Promise<number | null> {
    if (process.platform === 'linux') {
      const first = await this.readProcStat();
      if (!first) return this.loadAvgFallback();
      await sleep(this.sampleDelayMs);
      const second = await this.readProcStat();
      if (!second) return this.loadAvgFallback();
      return this.cpuPercentFromSamplePair(first, second);
    }

    return this.loadAvgFallback();
  }

  private cpuPercentFromSamplePair(first: CpuSample, second: CpuSample): number {
    const idleDelta = second.idle - first.idle;
    const totalDelta = second.total - first.total;
    if (totalDelta <= 0) return 0;
    return round1(clamp((1 - idleDelta / totalDelta) * 100, 0, 100));
  }

  private loadAvgFallback(): number {
    const load = os.loadavg()[0] ?? 0;
    const cores = Math.max(os.cpus().length, 1);
    return round1(clamp((load / cores) * 100, 0, 100));
  }

  private async readProcStat(): Promise<CpuSample | null> {
    for (const root of this.procRoots) {
      const sample = await readProcStatFile(`${root}/stat`);
      if (sample) return sample;
    }
    return null;
  }

  private async readTemperatureC(): Promise<number | null> {
    if (process.platform !== 'linux') {
      return null;
    }

    try {
      const zones = await fs.readdir('/sys/class/thermal');
      const preferred: number[] = [];
      const fallback: number[] = [];

      for (const zone of zones) {
        if (!zone.startsWith('thermal_zone')) continue;
        try {
          const type = (
            await fs.readFile(`/sys/class/thermal/${zone}/type`, 'utf8')
          ).trim();
          const raw = await fs.readFile(`/sys/class/thermal/${zone}/temp`, 'utf8');
          const milliC = Number.parseInt(raw.trim(), 10);
          if (Number.isNaN(milliC)) continue;
          const c = milliC / 1000;
          // Prefer real CPU package sensors; ACPI TZ often reports junk or ambient
          if (/pkg|x86|cpu|core/i.test(type)) preferred.push(c);
          else if (!/acpitz|acpi/i.test(type)) fallback.push(c);
        } catch {
          // ignore
        }
      }

      const readings = preferred.length > 0 ? preferred : fallback;
      if (readings.length === 0) return null;
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
      return { used: total - free, total };
    } catch {
      return null;
    }
  }
}

function defaultProcRoots(): string[] {
  const fromEnv = process.env.DOCKORA_HOST_PROC?.trim();
  const roots = [fromEnv, '/proc'].filter((v): v is string => Boolean(v && v.length > 0));
  return [...new Set(roots)];
}

function fallbackOsMemory(): MemorySample {
  const totalBytes = os.totalmem();
  return { totalBytes, usedBytes: Math.max(0, totalBytes - os.freemem()) };
}

async function readHostProcSnap(
  snapPath: string,
): Promise<{ meminfo: string; stat: string; df: string } | null> {
  try {
    const st = await fs.stat(snapPath);
    // veraltet (>30s) ignorieren – host-agent schreibt alle ~10s
    if (Date.now() - st.mtimeMs > 30_000) return null;
    const raw = await fs.readFile(snapPath, 'utf8');
    const [meminfo, rest] = raw.split('----STAT----');
    if (!meminfo || !rest) return null;
    const [stat, dfPart] = rest.split('----DF----');
    return {
      meminfo: meminfo.trim(),
      stat: (stat ?? '').trim(),
      df: (dfPart ?? '').trim(),
    };
  } catch {
    return null;
  }
}

function parseMeminfo(content: string): MemorySample | null {
  const totalKb = matchMemKb(content, 'MemTotal');
  if (totalKb === null || totalKb <= 0) return null;
  const availableKb = matchMemKb(content, 'MemAvailable');
  const freeKb = matchMemKb(content, 'MemFree') ?? 0;
  const usedKb =
    availableKb !== null ? Math.max(0, totalKb - availableKb) : Math.max(0, totalKb - freeKb);
  return { totalBytes: totalKb * 1024, usedBytes: usedKb * 1024 };
}

async function readMeminfoFile(filePath: string): Promise<MemorySample | null> {
  try {
    return parseMeminfo(await fs.readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function matchMemKb(content: string, key: string): number | null {
  const re = new RegExp(`^${key}:\\s+(\\d+)\\s+kB`, 'm');
  const m = content.match(re);
  if (!m) return null;
  const n = Number.parseInt(m[1]!, 10);
  return Number.isFinite(n) ? n : null;
}

function parseProcStat(content: string): CpuSample | null {
  const line = content.split('\n').find((l) => l.startsWith('cpu '));
  if (!line) return null;
  const parts = line.trim().split(/\s+/).slice(1).map(Number);
  if (parts.length < 4 || parts.some((n) => Number.isNaN(n))) return null;
  const idle = (parts[3] ?? 0) + (parts[4] ?? 0);
  const total = parts.reduce((a, b) => a + b, 0);
  return { idle, total };
}

/** Count `cpu0`…`cpuN` lines in /proc/stat (logical cores). */
function countCpuCores(content: string): number | null {
  let n = 0;
  for (const line of content.split('\n')) {
    if (/^cpu\d+/.test(line)) n += 1;
  }
  return n > 0 ? n : null;
}

async function readProcStatFile(filePath: string): Promise<CpuSample | null> {
  try {
    return parseProcStat(await fs.readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function parseDfLine(line: string): { used: number; total: number } | null {
  // df -B1 -P: Filesystem 1024-blocks Used Available Capacity Mounted
  const parts = line.trim().split(/\s+/);
  if (parts.length < 4) return null;
  const total = Number.parseInt(parts[1]!, 10);
  const used = Number.parseInt(parts[2]!, 10);
  if (!Number.isFinite(total) || !Number.isFinite(used) || total <= 0) return null;
  return { total, used };
}

async function readCgroupMemory(): Promise<MemorySample | null> {
  const v2 = await readCgroupV2Memory('/sys/fs/cgroup');
  if (v2) return v2;

  try {
    const limitRaw = await fs.readFile('/sys/fs/cgroup/memory/memory.limit_in_bytes', 'utf8');
    const usageRaw = await fs.readFile('/sys/fs/cgroup/memory/memory.usage_in_bytes', 'utf8');
    const limit = Number.parseInt(limitRaw.trim(), 10);
    const usage = Number.parseInt(usageRaw.trim(), 10);
    if (!Number.isFinite(limit) || limit <= 0 || limit > 1e15) return null;
    if (!Number.isFinite(usage) || usage < 0) return null;
    return { totalBytes: limit, usedBytes: Math.min(usage, limit) };
  } catch {
    return null;
  }
}

async function readCgroupV2Memory(root: string): Promise<MemorySample | null> {
  try {
    const maxRaw = (await fs.readFile(`${root}/memory.max`, 'utf8')).trim();
    if (maxRaw === 'max') return null;
    const max = Number.parseInt(maxRaw, 10);
    if (!Number.isFinite(max) || max <= 0) return null;
    const current = Number.parseInt(
      (await fs.readFile(`${root}/memory.current`, 'utf8')).trim(),
      10,
    );
    if (!Number.isFinite(current) || current < 0) return null;
    return { totalBytes: max, usedBytes: Math.min(current, max) };
  } catch {
    return null;
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
