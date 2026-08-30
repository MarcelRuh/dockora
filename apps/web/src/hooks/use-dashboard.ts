'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { DashboardOverview } from '@dockora/shared';
import { fetchDashboard } from '@/lib/api';
import { openEventSource } from '@/lib/sse';

export type DashboardLoadState = 'idle' | 'loading' | 'ready' | 'error';

export interface UseDashboardResult {
  data: DashboardOverview | null;
  state: DashboardLoadState;
  error: string | null;
  lastUpdated: Date | null;
  refresh: () => Promise<void>;
}

const POLL_INTERVAL_MS = 10_000;

/**
 * Live-Dashboard: bevorzugt SSE direkt gegen die API, Fallback Polling.
 */
export function useDashboard(): UseDashboardResult {
  const [data, setData] = useState<DashboardOverview | null>(null);
  const [state, setState] = useState<DashboardLoadState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setState((prev) => (prev === 'ready' ? prev : 'loading'));

    try {
      const overview = await fetchDashboard();
      setData(overview);
      setError(null);
      setState('ready');
      setLastUpdated(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setState((prev) => (prev === 'ready' ? 'ready' : 'error'));
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    let closed = false;
    let receivedSse = false;
    let es: EventSource | null = null;
    let pollTimer: number | undefined;

    const clearPoll = () => {
      window.clearInterval(pollTimer);
      pollTimer = undefined;
    };

    const startPolling = () => {
      clearPoll();
      void refresh();
      pollTimer = window.setInterval(() => {
        if (document.visibilityState === 'visible') void refresh();
      }, POLL_INTERVAL_MS);
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        void refresh();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    try {
      es = openEventSource('/api/v1/dashboard/stream');
      setState((prev) => (prev === 'ready' ? prev : 'loading'));

      es.addEventListener('dashboard', (event) => {
        if (closed) return;
        receivedSse = true;
        clearPoll();
        try {
          const overview = JSON.parse((event as MessageEvent).data) as DashboardOverview;
          setData(overview);
          setError(null);
          setState('ready');
          setLastUpdated(new Date());
        } catch {
          setError('Invalid dashboard SSE payload');
        }
      });

      es.onerror = () => {
        if (closed) return;
        if (receivedSse && es?.readyState !== EventSource.CLOSED) return;
        receivedSse = false;
        es?.close();
        es = null;
        startPolling();
      };
    } catch {
      startPolling();
    }

    const fallbackTimer = window.setTimeout(() => {
      if (!closed && !receivedSse) {
        es?.close();
        es = null;
        startPolling();
      }
    }, 3_000);

    return () => {
      closed = true;
      window.clearTimeout(fallbackTimer);
      clearPoll();
      es?.close();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [refresh]);

  return { data, state, error, lastUpdated, refresh };
}
