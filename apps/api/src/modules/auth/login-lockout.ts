import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** Login brute-force Schutz. Optional auf eine Datei gespiegelt, damit ein Neustart die Sperre behält. */

interface LockState {
  failures: number;
  lockedUntil: number;
  windowStartedAt: number;
}

const locks = new Map<string, LockState>();
let persistPath: string | null = null;

export function useLoginLockoutFile(filePath: string): void {
  persistPath = filePath;
  try {
    if (!existsSync(filePath)) return;
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, LockState>;
    locks.clear();
    for (const [key, state] of Object.entries(parsed)) {
      if (!state || typeof state.failures !== 'number') continue;
      locks.set(key, state);
    }
  } catch {
    // Login bleibt nutzbar, auch wenn die Datei kaputt ist.
  }
}

function persistLocks(): void {
  if (!persistPath) return;
  try {
    mkdirSync(path.dirname(persistPath), { recursive: true });
    const payload: Record<string, LockState> = {};
    for (const [key, state] of locks) payload[key] = state;
    writeFileSync(persistPath, JSON.stringify(payload));
  } catch {
    // Sperre gilt weiter im Speicher.
  }
}

const MAX_FAILURES = 5;
const LOCK_MS = 15 * 60 * 1000;
const FAILURE_WINDOW_MS = 15 * 60 * 1000;

export function loginLockKey(ip: string, email: string): string {
  return `${ip}::${email.toLowerCase()}`;
}

export function assertLoginAllowed(key: string): void {
  const state = locks.get(key);
  if (!state) return;
  if (state.lockedUntil > Date.now()) {
    const mins = Math.ceil((state.lockedUntil - Date.now()) / 60_000);
    throw new Error(`Too many failed logins. Try again in ${mins} minute(s).`);
  }
}

export function recordLoginFailure(key: string): void {
  const now = Date.now();
  const prev = locks.get(key);

  const windowExpired =
    !prev ||
    (prev.lockedUntil > 0 && prev.lockedUntil < now) ||
    now - prev.windowStartedAt > FAILURE_WINDOW_MS;

  if (windowExpired) {
    locks.set(key, { failures: 1, lockedUntil: 0, windowStartedAt: now });
    persistLocks();
    return;
  }

  const failures = prev.failures + 1;
  locks.set(key, {
    failures,
    lockedUntil: failures >= MAX_FAILURES ? now + LOCK_MS : 0,
    windowStartedAt: prev.windowStartedAt,
  });
  persistLocks();
}

export function clearLoginFailures(key: string): void {
  locks.delete(key);
  persistLocks();
}

/** Test helper */
export function resetLoginLocks(): void {
  locks.clear();
}
