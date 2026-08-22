import { describe, expect, it } from 'vitest';
import { formatBytes, formatPercent, usageRatio } from './format.js';

describe('formatBytes', () => {
  it('formats common sizes', () => {
    expect(formatBytes(0, 'en')).toBe('0 B');
    expect(formatBytes(1024, 'en')).toBe('1 KB');
    expect(formatBytes(null)).toBe('—');
  });
});

describe('formatPercent', () => {
  it('formats percentages', () => {
    expect(formatPercent(12.56, 'en')).toContain('12.6');
    expect(formatPercent(null)).toBe('—');
  });
});

describe('usageRatio', () => {
  it('computes clamped ratio', () => {
    expect(usageRatio(50, 100)).toBe(50);
    expect(usageRatio(120, 100)).toBe(100);
    expect(usageRatio(10, 0)).toBeNull();
  });
});
