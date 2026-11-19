/**
 * Share in-flight work and cache the last successful result for `ttlMs`.
 * `clear()` bumps a generation counter so a request that was already running when the cache was
 * invalidated can neither repopulate the cache with pre-change data nor reset a newer in-flight call.
 */
export function createTtlMemo<T>(ttlMs: number): {
  get: (factory: () => Promise<T>) => Promise<T>;
  clear: () => void;
} {
  let cached: { at: number; value: T } | null = null;
  let inflight: Promise<T> | null = null;
  let generation = 0;

  return {
    async get(factory) {
      const now = Date.now();
      if (cached && now - cached.at < ttlMs) return cached.value;
      if (inflight) return inflight;
      const gen = generation;
      const current: Promise<T> = factory()
        .then((value) => {
          if (gen === generation) cached = { at: Date.now(), value };
          return value;
        })
        .finally(() => {
          if (inflight === current) inflight = null;
        });
      inflight = current;
      return current;
    },
    clear() {
      generation++;
      cached = null;
      inflight = null;
    },
  };
}
