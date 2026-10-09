import { describe, expect, it } from 'vitest';
import { cronFromUpdateIntervalMinutes } from './update-check-cron.js';

describe('cronFromUpdateIntervalMinutes', () => {
  it('uses every N minutes under one hour', () => {
    expect(cronFromUpdateIntervalMinutes(30)).toBe('*/30 * * * *');
    expect(cronFromUpdateIntervalMinutes(15)).toBe('*/15 * * * *');
  });

  it('uses every N hours from 60 minutes up', () => {
    expect(cronFromUpdateIntervalMinutes(60)).toBe('0 */1 * * *');
    expect(cronFromUpdateIntervalMinutes(120)).toBe('0 */2 * * *');
    expect(cronFromUpdateIntervalMinutes(180)).toBe('0 */3 * * *');
  });

  it('clamps below 15 minutes and above one day', () => {
    expect(cronFromUpdateIntervalMinutes(5)).toBe('*/15 * * * *');
    expect(cronFromUpdateIntervalMinutes(10_000)).toBe('0 0 * * *');
  });
});
