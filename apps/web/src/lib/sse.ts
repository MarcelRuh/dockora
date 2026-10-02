import { getSessionToken } from './auth';

/**
 * Basis-URL für SSE/WS.
 *
 * Default: Same-Origin (`''`) – SSE läuft über Next Route-Handler
 * (`app/api/v1/.../stream`) ohne Rewrite-Buffering.
 * In Produktion mit nginx: `docker compose --profile proxy up`
 * (siehe deploy/nginx.conf) – dann ebenfalls Same-Origin ohne NEXT_PUBLIC_*.
 *
 * Dev-Override (direkter API-Port): NEXT_PUBLIC_API_HTTP / NEXT_PUBLIC_API_WS.
 */
export function apiDirectBaseUrl(): string {
  if (typeof window === 'undefined') return '';
  if (process.env.NEXT_PUBLIC_API_HTTP) return process.env.NEXT_PUBLIC_API_HTTP;
  return '';
}

/**
 * Same-origin EventSource sends the HttpOnly cookie.
 * Cross-origin EventSource cannot set headers, so that path uses fetch
 * and `Authorization` instead of putting the JWT in the URL.
 */
export function withAuthQuery(
  url: string,
  _options?: { token?: string | null; crossOrigin?: boolean },
): string {
  return url;
}

type StreamHandler = (event: MessageEvent) => void;

class HeaderEventSource {
  readyState = 0;
  onmessage: StreamHandler | null = null;
  onerror: ((event: Event) => void) | null = null;
  private readonly listeners = new Map<string, Set<StreamHandler>>();
  private readonly abort = new AbortController();

  constructor(url: string, token: string) {
    void this.read(url, token);
  }

  addEventListener(type: string, handler: StreamHandler): void {
    const set = this.listeners.get(type) ?? new Set<StreamHandler>();
    set.add(handler);
    this.listeners.set(type, set);
  }

  close(): void {
    this.readyState = 2;
    this.abort.abort();
  }

  private emit(type: string, data: string): void {
    const event = new MessageEvent(type, { data });
    if (type === 'message') this.onmessage?.(event);
    this.listeners.get(type)?.forEach((handler) => handler(event));
  }

  private consume(buffer: string): string {
    const blocks = buffer.split('\n\n');
    const rest = blocks.pop() ?? '';
    for (const block of blocks) {
      let name = 'message';
      const data: string[] = [];
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) name = line.slice(6).trim();
        else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
      }
      if (data.length > 0) this.emit(name, data.join('\n'));
    }
    return rest;
  }

  private async read(url: string, token: string): Promise<void> {
    try {
      const response = await fetch(url, {
        signal: this.abort.signal,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'text/event-stream',
        },
      });
      if (!response.ok || !response.body) throw new Error('stream failed');
      this.readyState = 1;
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (this.readyState === 1) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        buffer = this.consume(buffer);
      }
      if (this.readyState === 1) {
        this.readyState = 2;
        this.onerror?.(new Event('error'));
      }
    } catch {
      if (this.readyState !== 2) {
        this.readyState = 2;
        this.onerror?.(new Event('error'));
      }
    }
  }
}

export function openEventSource(pathWithQuery: string): EventSource {
  const base = apiDirectBaseUrl();
  const url = `${base}${pathWithQuery}`;
  const token = getSessionToken();
  if (base && token) return new HeaderEventSource(url, token) as unknown as EventSource;
  return new EventSource(url, { withCredentials: true });
}
