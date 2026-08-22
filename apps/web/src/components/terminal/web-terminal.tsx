'use client';

import { useEffect, useRef } from 'react';

function wsBaseUrl(): string {
  if (typeof window === 'undefined') return '';
  if (process.env.NEXT_PUBLIC_API_WS) return process.env.NEXT_PUBLIC_API_WS;
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}`;
}

export type WebTerminalProps = {
  /** Path under /api/v1, e.g. /containers/abc/terminal or /system/host-terminal */
  path: string;
  token: string | null;
  errorLabel: string;
  unauthorizedLabel: string;
  className?: string;
  heightClassName?: string;
};

/**
 * Shared xterm.js WebSocket terminal (container or host).
 */
export function WebTerminal({
  path,
  token,
  errorLabel,
  unauthorizedLabel,
  className,
  heightClassName = 'h-[min(70vh,560px)]',
}: WebTerminalProps) {
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
      term.focus();

      const keepTabInTerminal = (ev: KeyboardEvent) => {
        if (ev.key !== 'Tab' || !host.contains(ev.target as Node)) return;
        ev.preventDefault();
      };
      const focusTerm = () => term?.focus();
      host.addEventListener('keydown', keepTabInTerminal, true);
      host.addEventListener('mousedown', focusTerm);

      const qs = new URLSearchParams({
        cols: String(term.cols),
        rows: String(term.rows),
      });
      const wsUrl = `${wsBaseUrl()}/api/v1${path}?${qs}`;

      const protocols = token ? [`dockora.jwt.${token}`] : undefined;
      const ws = protocols ? new WebSocket(wsUrl, protocols) : new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        term?.writeln('');
      };

      const decoder = new TextDecoder();
      ws.onmessage = (ev) => {
        if (typeof ev.data === 'string') {
          term?.write(ev.data);
          return;
        }
        if (ev.data instanceof ArrayBuffer) {
          term?.write(decoder.decode(ev.data));
          return;
        }
        if (ev.data instanceof Blob) {
          void ev.data.arrayBuffer().then((buf) => term?.write(decoder.decode(buf)));
        }
      };

      ws.onerror = () => {
        term?.writeln(`\r\n${errorLabel}`);
      };

      ws.onclose = (ev) => {
        if (ev.code === 1008 || ev.code === 4401 || ev.code === 4403) {
          term?.writeln(`\r\n${unauthorizedLabel}`);
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
        host.removeEventListener('keydown', keepTabInTerminal, true);
        host.removeEventListener('mousedown', focusTerm);
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
  }, [path, token, errorLabel, unauthorizedLabel]);

  return (
    <div
      ref={hostRef}
      tabIndex={0}
      className={
        className ??
        `mt-3 overflow-hidden rounded-md border border-dockora-border bg-dockora-rail p-1 ${heightClassName}`
      }
    />
  );
}
