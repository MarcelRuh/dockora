import { describe, expect, it, beforeEach } from 'vitest';
import {
  alertFingerprint,
  filterAlertsWithCooldown,
  resetAlertCooldown,
} from './alert-cooldown.js';

describe('alertFingerprint', () => {
  it('normalizes fluctuating percentages and sizes', () => {
    expect(alertFingerprint('CPU usage 91% exceeds threshold')).toBe(
      alertFingerprint('CPU usage 99% exceeds threshold'),
    );
    expect(alertFingerprint('Disk 12.5 GB free')).toBe(alertFingerprint('Disk 3 GB free'));
  });
});

describe('filterAlertsWithCooldown', () => {
  beforeEach(() => {
    resetAlertCooldown();
  });

  it('lets new alerts through once', () => {
    const first = filterAlertsWithCooldown(['cpu high', 'disk full'], 60_000, 1_000);
    expect(first).toEqual(['cpu high', 'disk full']);

    const second = filterAlertsWithCooldown(['cpu high', 'disk full'], 60_000, 2_000);
    expect(second).toEqual([]);
  });

  it('re-allows after cooldown', () => {
    filterAlertsWithCooldown(['cpu high'], 1_000, 0);
    const again = filterAlertsWithCooldown(['cpu high'], 1_000, 1_001);
    expect(again).toEqual(['cpu high']);
  });

  it('allows newly appearing alerts immediately', () => {
    filterAlertsWithCooldown(['cpu high'], 60_000, 0);
    const next = filterAlertsWithCooldown(['cpu high', 'ram high'], 60_000, 100);
    expect(next).toEqual(['ram high']);
  });

  it('dedupes same fingerprint with different numbers', () => {
    const first = filterAlertsWithCooldown(['CPU usage 80% exceeds threshold'], 60_000, 0);
    expect(first).toHaveLength(1);
    const second = filterAlertsWithCooldown(['CPU usage 95% exceeds threshold'], 60_000, 100);
    expect(second).toEqual([]);
  });
});
