import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, beforeEach } from 'vitest';
import {
  assertLoginAllowed,
  clearLoginFailures,
  loginLockKey,
  recordLoginFailure,
  resetLoginLocks,
  useLoginLockoutFile,
} from './login-lockout.js';

describe('login-lockout', () => {
  beforeEach(() => resetLoginLocks());

  it('locks after max failures', () => {
    const key = loginLockKey('1.2.3.4', 'a@b.c');
    for (let i = 0; i < 5; i++) recordLoginFailure(key);
    expect(() => assertLoginAllowed(key)).toThrow(/Too many failed logins/);
  });

  it('reloads a lock after a restart', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'dockora-lock-'));
    const file = path.join(dir, 'login-lockout.json');
    useLoginLockoutFile(file);
    const key = loginLockKey('9.9.9.9', 'lock@dockora.local');
    for (let i = 0; i < 5; i++) recordLoginFailure(key);
    expect(readFileSync(file, 'utf8')).toContain(key);
    resetLoginLocks();
    useLoginLockoutFile(file);
    expect(() => assertLoginAllowed(key)).toThrow(/Too many failed logins/);
    resetLoginLocks();
  });

  it('clears on success', () => {
    const key = loginLockKey('1.2.3.4', 'a@b.c');
    recordLoginFailure(key);
    clearLoginFailures(key);
    expect(() => assertLoginAllowed(key)).not.toThrow();
  });
});
