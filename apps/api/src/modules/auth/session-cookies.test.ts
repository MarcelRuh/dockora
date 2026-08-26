import { describe, expect, it } from 'vitest';
import { headerValue, jwtExpiresToSeconds } from './session-cookies.js';

describe('jwtExpiresToSeconds', () => {
  it('parses day/hour/minute/second units', () => {
    expect(jwtExpiresToSeconds('7d')).toBe(7 * 24 * 3600);
    expect(jwtExpiresToSeconds('12h')).toBe(12 * 3600);
    expect(jwtExpiresToSeconds('30m')).toBe(1800);
    expect(jwtExpiresToSeconds('45s')).toBe(45);
  });

  it('falls back for unknown values', () => {
    expect(jwtExpiresToSeconds('nope')).toBe(7 * 24 * 3600);
  });
});

describe('headerValue', () => {
  it('unwraps string arrays', () => {
    expect(headerValue(['abc', 'def'])).toBe('abc');
    expect(headerValue('xyz')).toBe('xyz');
    expect(headerValue(undefined)).toBeUndefined();
  });
});
