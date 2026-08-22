import { describe, expect, it, beforeEach } from 'vitest';
import {
  assertLoginAllowed,
  clearLoginFailures,
  loginLockKey,
  recordLoginFailure,
  resetLoginLocks,
} from './login-lockout.js';

describe('login-lockout', () => {
  beforeEach(() => resetLoginLocks());

  it('locks after max failures', () => {
    const key = loginLockKey('1.2.3.4', 'a@b.c');
    for (let i = 0; i < 5; i++) recordLoginFailure(key);
    expect(() => assertLoginAllowed(key)).toThrow(/Too many failed logins/);
  });

  it('clears on success', () => {
    const key = loginLockKey('1.2.3.4', 'a@b.c');
    recordLoginFailure(key);
    clearLoginFailures(key);
    expect(() => assertLoginAllowed(key)).not.toThrow();
  });
});
