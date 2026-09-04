import { describe, expect, it } from 'vitest';
import {
  applyLifetimeSample,
  emptyLifetimeRow,
  lifetimeEventCounter,
  toLifetimeSnapshot,
} from './lifetime.service.js';

describe('lifetimeEventCounter', () => {
  it('maps container lifecycle actions', () => {
    expect(lifetimeEventCounter('container', 'start')).toBe('containerStarts');
    expect(lifetimeEventCounter('container', 'stop')).toBe('containerStops');
    expect(lifetimeEventCounter('container', 'die')).toBe('containerDies');
    expect(lifetimeEventCounter('container', 'oom')).toBe('containerDies');
    expect(lifetimeEventCounter('container', 'restart')).toBe('containerRestarts');
    expect(lifetimeEventCounter('image', 'pull')).toBeNull();
    expect(lifetimeEventCounter('container', 'exec_start')).toBeNull();
  });
});

describe('applyLifetimeSample', () => {
  it('tracks peaks, sums, and max container count', () => {
    const first = applyLifetimeSample(emptyLifetimeRow(new Date('2026-01-01T00:00:00.000Z')), {
      cpuPercent: 10,
      memoryPercent: 20,
      diskPercent: 30,
      containerCount: 4,
    }, new Date('2026-01-01T01:00:00.000Z'));
    const second = applyLifetimeSample(first, {
      cpuPercent: 40,
      memoryPercent: 15,
      diskPercent: 30,
      containerCount: 2,
    }, new Date('2026-01-01T02:00:00.000Z'));

    expect(second.samplesCount).toBe(2);
    expect(second.peakCpuPercent).toBe(40);
    expect(second.peakMemoryPercent).toBe(20);
    expect(second.maxContainersSeen).toBe(4);
    expect(toLifetimeSnapshot(second).avgCpuPercent).toBe(25);
  });

  it('ignores null metrics for peaks but still records container count', () => {
    const next = applyLifetimeSample(emptyLifetimeRow(), {
      cpuPercent: null,
      memoryPercent: null,
      diskPercent: null,
      containerCount: 7,
    });
    expect(next.samplesCount).toBe(0);
    expect(next.maxContainersSeen).toBe(7);
  });
});
