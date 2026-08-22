/**
 * Approximate next fire time for a 5-field cron expression (m h dom mon dow).
 * Scans minute-by-minute up to `horizonMinutes` (default 14 days).
 */
export function nextCronRunIso(
  expression: string,
  from = new Date(),
  horizonMinutes = 14 * 24 * 60,
): string | undefined {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return undefined;

  const [minF, hourF, domF, monF, dowF] = parts as [string, string, string, string, string];
  const start = new Date(from);
  start.setSeconds(0, 0);
  start.setMinutes(start.getMinutes() + 1);

  for (let i = 0; i < horizonMinutes; i++) {
    const candidate = new Date(start.getTime() + i * 60_000);
    if (
      fieldMatches(minF, candidate.getMinutes(), 0, 59) &&
      fieldMatches(hourF, candidate.getHours(), 0, 23) &&
      fieldMatches(monF, candidate.getMonth() + 1, 1, 12) &&
      dayMatches(domF, dowF, candidate)
    ) {
      return candidate.toISOString();
    }
  }
  return undefined;
}

function dayMatches(domF: string, dowF: string, date: Date): boolean {
  const domOk = fieldMatches(domF, date.getDate(), 1, 31);
  // cron: 0 and 7 = Sunday
  const dow = date.getDay();
  const dowOk = fieldMatches(dowF, dow, 0, 7) || (dow === 0 && fieldMatches(dowF, 7, 0, 7));

  const domStar = domF === '*';
  const dowStar = dowF === '*';
  if (domStar && dowStar) return true;
  if (!domStar && dowStar) return domOk;
  if (domStar && !dowStar) return dowOk;
  // Both constrained: either may match (common cron semantics)
  return domOk || dowOk;
}

function fieldMatches(field: string, value: number, min: number, max: number): boolean {
  if (field === '*') return true;

  for (const part of field.split(',')) {
    const stepMatch = /^(\*|\d+(?:-\d+)?)\/(\d+)$/.exec(part);
    if (stepMatch) {
      const base = stepMatch[1]!;
      const step = Number(stepMatch[2]);
      if (!Number.isFinite(step) || step <= 0) continue;
      let rangeMin = min;
      let rangeMax = max;
      if (base !== '*') {
        const range = parseRange(base, min, max);
        if (!range) continue;
        rangeMin = range[0];
        rangeMax = range[1];
      }
      if (value < rangeMin || value > rangeMax) continue;
      if ((value - rangeMin) % step === 0) return true;
      continue;
    }

    const range = parseRange(part, min, max);
    if (!range) continue;
    if (value >= range[0] && value <= range[1]) return true;
  }
  return false;
}

function parseRange(part: string, min: number, max: number): [number, number] | null {
  if (part.includes('-')) {
    const [a, b] = part.split('-').map(Number);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    return [Math.max(min, a!), Math.min(max, b!)];
  }
  const n = Number(part);
  if (!Number.isFinite(n)) return null;
  if (n < min || n > max) return null;
  return [n, n];
}
