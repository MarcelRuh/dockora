'use client';

import { useEffect, useRef } from 'react';
import { openEventSource } from '@/lib/sse';

const COALESCE_MS = 400;

/**
 * Refresh on Docker resource SSE, with a slow fallback poll while the tab is visible.
 */
export function useDockerLiveReload(onChange: () => void, fallbackMs = 60_000): void {
  const cbRef = useRef(onChange);
  cbRef.current = onChange;

  useEffect(() => {
    let es: EventSource | null = null;
    let debounce: number | undefined;

    const fire = () => {
      if (document.visibilityState !== 'visible') return;
      cbRef.current();
    };

    const schedule = () => {
      window.clearTimeout(debounce);
      debounce = window.setTimeout(fire, COALESCE_MS);
    };

    try {
      es = openEventSource('/api/v1/events/stream');
      es.addEventListener('change', schedule);
    } catch {
      // fallback interval only
    }

    const fallback = window.setInterval(fire, fallbackMs);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') fire();
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      es?.close();
      window.clearTimeout(debounce);
      window.clearInterval(fallback);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [fallbackMs]);
}
