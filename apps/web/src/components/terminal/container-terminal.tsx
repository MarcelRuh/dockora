'use client';

import { useEffect, useRef } from 'react';
import { useLocale } from '@/i18n/locale-provider';
import { getAuthToken } from '@/lib/auth';

function wsBaseUrl(): string {
  if (typeof window === 'undefined') return '';
  if (process.env.NEXT_PUBLIC_API_WS) return process.env.NEXT_PUBLIC_API_WS;
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}`;
}

export function ContainerTerminal({ containerId }: { containerId: string }) {
  const { t } = useLocale();
  const hostRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let disposed = false;
    let term: import('xterm').Terminal | null = null;
    let fitAddon: import('@xterm/addon-fit').FitAddon | null = null;

    const init = async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import('xterm'),
        import('@xterm/addon-fit'),
      ]);

      if (disposed) return;

      term = new Terminal({
        cursorBlink: true,
        fontFamily: 'var(--font-mono), ui-monospace, monospace',
        fontSize: 13,
        theme: {
          background: '#0a0d14',
          foreground: '#eef1f6',
          cursor: '#e07040',
        },
      });

      fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.open(host);
      fitAddon.fit();

      const qs = new URLSearchParams({
        cols: String(term.cols),
        rows: String(term.rows),
      });
      const token = getAuthToken();
      if (token) qs.set('token', token);

      const wsUrl = `${wsBaseUrl()}/api/v1/containers/${encodeURIComponent(containerId)}/terminal?${qs}`;

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        term?.writeln('');
      };

      ws.onmessage = (ev) => {
        term?.write(typeof ev.data === 'string' ? ev.data : '');
      };

      ws.onerror = () => {
        term?.writeln(`\r\n${t.containers.terminal.error}`);
      };

      ws.onclose = (ev) => {
        if (ev.code === 1008 || ev.code === 4401 || ev.code === 4403) {
          term?.writeln(`\r\n${t.containers.terminal.unauthorized}`);
        } else {
          term?.writeln('\r\n[disconnected]');
        }
      };

      term.onData((data) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(data);
      });

      const onResize = () => {
        fitAddon?.fit();
        if (ws.readyState === WebSocket.OPEN && term) {
          ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
        }
      };

      window.addEventListener('resize', onResize);
      const ro = new ResizeObserver(onResize);
      ro.observe(host);

      return () => {
        window.removeEventListener('resize', onResize);
        ro.disconnect();
      };
    };

    let cleanupResize: (() => void) | undefined;
    void init().then((fn) => {
      cleanupResize = fn;
    });

    return () => {
      disposed = true;
      wsRef.current?.close();
      wsRef.current = null;
      cleanupResize?.();
      term?.dispose();
    };
  }, [containerId, t.containers.terminal.error, t.containers.terminal.unauthorized]);

  return (
    <div
      ref={hostRef}
      className="mt-3 h-[420px] overflow-hidden rounded-md border border-dockora-border bg-dockora-rail p-1"
    />
  );
}
