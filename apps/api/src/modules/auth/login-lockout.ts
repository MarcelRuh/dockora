/** Login brute-force Schutz (in-memory). */

interface LockState {
  failures: number;
  lockedUntil: number;
  windowStartedAt: number;
}

const locks = new Map<string, LockState>();

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
    return;
  }

  const failures = prev.failures + 1;
  locks.set(key, {
    failures,
    lockedUntil: failures >= MAX_FAILURES ? now + LOCK_MS : 0,
    windowStartedAt: prev.windowStartedAt,
  });
}

export function clearLoginFailures(key: string): void {
  locks.delete(key);
}

/** Test helper */
export function resetLoginLocks(): void {
  locks.clear();
}
