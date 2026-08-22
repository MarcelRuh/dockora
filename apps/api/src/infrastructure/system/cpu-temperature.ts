import fs from 'node:fs/promises';
import path from 'node:path';

const PREFERRED = /pkg|x86|cpu|core|k10|zen/i;
const IGNORED = /acpi|acpitz|nvme|wifi|iwlwifi|pch|nct|superio/i;

/** Linux thermal/hwmon values are millidegrees; some devices report °C. */
export function milliCToCelsius(raw: string | number): number | null {
  const n = typeof raw === 'number' ? raw : Number.parseInt(String(raw).trim(), 10);
  if (!Number.isFinite(n)) return null;
  const c = Math.abs(n) >= 1000 ? n / 1000 : n;
  if (c < 5 || c > 125) return null;
  return round1(c);
}

export function pickCpuTemperature(
  readings: Array<{ source: string; celsius: number }>,
): number | null {
  if (readings.length === 0) return null;
  const preferred = readings.filter((r) => PREFERRED.test(r.source) && !IGNORED.test(r.source));
  const fallback = readings.filter((r) => !IGNORED.test(r.source));
  const pool = preferred.length > 0 ? preferred : fallback;
  if (pool.length === 0) return null;
  return round1(Math.max(...pool.map((r) => r.celsius)));
}

export function parseSnapTemperature(raw: string | undefined): number | null {
  if (!raw?.trim()) return null;
  const line = raw.trim().split(/\r?\n/).find((l) => l.trim() && !l.startsWith('#'));
  return line ? milliCToCelsius(line) : null;
}

/**
 * CPU-Pakettemperatur aus thermal_zone + hwmon (coretemp/k10temp).
 * Mehrere Pfade, damit Host-Bind-Mounts automatisch greifen.
 */
export async function readCpuTemperatureC(
  thermalRoots = ['/sys/class/thermal', '/host/sys/class/thermal'],
  hwmonRoots = ['/sys/class/hwmon', '/host/sys/class/hwmon'],
): Promise<number | null> {
  if (process.platform !== 'linux') return null;
  const readings: Array<{ source: string; celsius: number }> = [];
  for (const root of thermalRoots) await collectThermalZones(root, readings);
  for (const root of hwmonRoots) await collectHwmon(root, readings);
  return pickCpuTemperature(readings);
}

async function collectThermalZones(
  root: string,
  out: Array<{ source: string; celsius: number }>,
): Promise<void> {
  let entries: string[];
  try {
    entries = await fs.readdir(root);
  } catch {
    return;
  }
  for (const name of entries) {
    if (!name.startsWith('thermal_zone')) continue;
    const dir = path.join(root, name);
    try {
      const type = (await fs.readFile(path.join(dir, 'type'), 'utf8')).trim();
      const celsius = milliCToCelsius(await fs.readFile(path.join(dir, 'temp'), 'utf8'));
      if (celsius !== null) out.push({ source: type, celsius });
    } catch {
      // skip
    }
  }
}

async function collectHwmon(
  root: string,
  out: Array<{ source: string; celsius: number }>,
): Promise<void> {
  let entries: string[];
  try {
    entries = await fs.readdir(root);
  } catch {
    return;
  }
  for (const name of entries) {
    if (!name.startsWith('hwmon')) continue;
    const chip = path.join(root, name);
    let chipName = name;
    try {
      chipName = (await fs.readFile(path.join(chip, 'name'), 'utf8')).trim() || name;
    } catch {
      // keep folder name
    }
    let files: string[];
    try {
      files = await fs.readdir(chip);
    } catch {
      continue;
    }
    for (const file of files) {
      if (!/^temp\d+_input$/.test(file)) continue;
      try {
        const celsius = milliCToCelsius(await fs.readFile(path.join(chip, file), 'utf8'));
        if (celsius !== null) out.push({ source: chipName, celsius });
      } catch {
        // skip
      }
    }
  }
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
