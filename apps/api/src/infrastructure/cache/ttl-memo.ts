/**
 * Share in-flight work and cache the last successful result for `ttlMs`.
 */
export function createTtlMemo<T>(ttlMs: number): {
  get: (factory: () => Promise<T>) => Promise<T>;
  clear: () => void;
} {
  let cached: { at: number; value: T } | null = null;
  let inflight: Promise<T> | null = null;

  return {
    async get(factory) {
      const now = Date.now();
      if (cached && now - cached.at < ttlMs) return cached.value;
      if (inflight) return inflight;
      inflight = factory()
        .then((value) => {
          cached = { at: Date.now(), value };
          return value;
        })
        .finally(() => {
          inflight = null;
        });
      return inflight;
    },
    clear() {
      cached = null;
      inflight = null;
    },
  };
}
