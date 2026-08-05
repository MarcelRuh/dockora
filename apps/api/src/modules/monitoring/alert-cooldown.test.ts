import { describe, expect, it, beforeEach } from 'vitest';
import { filterAlertsWithCooldown, resetAlertCooldown } from './alert-cooldown.js';

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
});
