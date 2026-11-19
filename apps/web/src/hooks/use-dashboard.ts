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

const POLL_INTERVAL_MS = 15_000;
const SSE_RETRY_MS = 60_000;

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
    let retryTimer: number | undefined;
    let fallbackTimer: number | undefined;
    /** Latest SSE payload received while the tab was hidden – applied once it is visible. */
    let hiddenPayload: DashboardOverview | null = null;

    const clearPoll = () => {
      window.clearInterval(pollTimer);
      pollTimer = undefined;
    };

    const apply = (overview: DashboardOverview) => {
      setData(overview);
      setError(null);
      setState('ready');
      setLastUpdated(new Date());
    };

    const startPolling = () => {
      if (closed) return;
      clearPoll();
      void refresh();
      pollTimer = window.setInterval(() => {
        if (document.visibilityState === 'visible') void refresh();
      }, POLL_INTERVAL_MS);
      // Try to get back on SSE after a proxy/API restart instead of polling forever.
      window.clearTimeout(retryTimer);
      retryTimer = window.setTimeout(connect, SSE_RETRY_MS);
    };

    const connect = () => {
      if (closed) return;
      receivedSse = false;
      try {
        es = openEventSource('/api/v1/dashboard/stream');
      } catch {
        startPolling();
        return;
      }
      setState((prev) => (prev === 'ready' ? prev : 'loading'));

      es.addEventListener('dashboard', (event) => {
        if (closed) return;
        receivedSse = true;
        clearPoll();
        window.clearTimeout(retryTimer);
        try {
          const overview = JSON.parse((event as MessageEvent).data) as DashboardOverview;
          // Don't re-render the whole dashboard in a background tab.
          if (document.visibilityState === 'hidden') {
            hiddenPayload = overview;
            return;
          }
          apply(overview);
        } catch {
          setError('Invalid dashboard SSE payload');
        }
      });

      es.onerror = () => {
        if (closed) return;
        if (receivedSse && es?.readyState !== EventSource.CLOSED) return;
        es?.close();
        es = null;
        startPolling();
      };

      window.clearTimeout(fallbackTimer);
      fallbackTimer = window.setTimeout(() => {
        if (!closed && !receivedSse && es) {
          es.close();
          es = null;
          startPolling();
        }
      }, 3_000);
    };

    const onVisibility = () => {
      if (document.visibilityState !== 'visible') return;
      if (hiddenPayload) {
        apply(hiddenPayload);
        hiddenPayload = null;
      } else if (!es) {
        void refresh();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    connect();

    return () => {
      closed = true;
      window.clearTimeout(fallbackTimer);
      window.clearTimeout(retryTimer);
      clearPoll();
      es?.close();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [refresh]);

  return { data, state, error, lastUpdated, refresh };
}
