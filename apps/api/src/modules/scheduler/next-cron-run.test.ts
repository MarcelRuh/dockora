import { describe, expect, it } from 'vitest';
import { nextCronRunIso } from './next-cron-run.js';

describe('nextCronRunIso', () => {
  it('finds the next hourly run', () => {
    const from = new Date(2026, 7, 7, 10, 15, 0);
    const next = nextCronRunIso('0 * * * *', from);
    expect(next).toBe(new Date(2026, 7, 7, 11, 0, 0).toISOString());
  });

  it('finds the next */5 minute run', () => {
    const from = new Date(2026, 7, 7, 10, 1, 0);
    const next = nextCronRunIso('*/5 * * * *', from);
    expect(next).toBe(new Date(2026, 7, 7, 10, 5, 0).toISOString());
  });

  it('returns undefined for invalid expressions', () => {
    expect(nextCronRunIso('not a cron')).toBeUndefined();
  });
});
