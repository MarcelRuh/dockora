import { describe, expect, it, vi } from 'vitest';
import { createTtlMemo } from './ttl-memo.js';

describe('createTtlMemo', () => {
  it('reuses in-flight and cached values', async () => {
    const memo = createTtlMemo<number>(60_000);
    let calls = 0;
    const factory = vi.fn(async () => {
      calls += 1;
      return calls;
    });

    const [a, b] = await Promise.all([memo.get(factory), memo.get(factory)]);
    expect(a).toBe(1);
    expect(b).toBe(1);
    expect(factory).toHaveBeenCalledTimes(1);

    const c = await memo.get(factory);
    expect(c).toBe(1);
    expect(factory).toHaveBeenCalledTimes(1);
  });
});
