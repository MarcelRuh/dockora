import { describe, expect, it } from 'vitest';
import { computeNetRate, parsePrimaryNetDev } from './host-metrics.js';

const SAMPLE = `
Inter-|   Receive                                                |  Transmit
 face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed
    lo: 100 0 0 0 0 0 0 0 200 0 0 0 0 0 0 0
  docker0: 50 0 0 0 0 0 0 0 60 0 0 0 0 0 0 0
  eth0: 1000 0 0 0 0 0 0 0 4000 0 0 0 0 0 0 0
`;

describe('parsePrimaryNetDev', () => {
  it('prefers a physical interface over loopback and docker bridges', () => {
    expect(parsePrimaryNetDev(SAMPLE)).toEqual({ iface: 'eth0', rx: 1000, tx: 4000 });
  });
});

describe('computeNetRate', () => {
  it('returns null until a previous sample exists', () => {
    expect(computeNetRate(null, { at: 10_000, rx: 100, tx: 50 })).toEqual({ rx: null, tx: null });
  });

  it('computes bytes per second from the delta', () => {
    expect(computeNetRate({ at: 0, rx: 1000, tx: 4000 }, { at: 10_000, rx: 3000, tx: 5000 })).toEqual({
      rx: 200,
      tx: 100,
    });
  });
});
