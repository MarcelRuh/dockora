import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, beforeEach } from 'vitest';
import {
  accountLockKey,
  assertLoginAllowed,
  assertLoginIdentities,
  clearLoginFailures,
  clearLoginIdentity,
  loginLockKey,
  recordLoginFailure,
  recordLoginIdentityFailure,
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

  it('keeps the account locked when the address changes', () => {
    const email = 'a@b.c';
    for (let i = 0; i < 5; i++) recordLoginIdentityFailure(`10.0.0.${i}`, email);
    expect(() => assertLoginIdentities('10.0.0.99', email)).toThrow(/Too many failed logins/);
    expect(() => assertLoginAllowed(accountLockKey(email))).toThrow(/Too many failed logins/);
    clearLoginIdentity('10.0.0.99', email);
    expect(() => assertLoginIdentities('192.168.1.8', email)).not.toThrow();
  });

  it('clears on success', () => {
    const key = loginLockKey('1.2.3.4', 'a@b.c');
    recordLoginFailure(key);
    clearLoginFailures(key);
    expect(() => assertLoginAllowed(key)).not.toThrow();
  });
});
