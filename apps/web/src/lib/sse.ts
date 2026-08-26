import { getSessionToken } from '@/lib/auth';

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

export function withAuthQuery(url: string): string {
  const token = getSessionToken();
  if (!token) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}token=${encodeURIComponent(token)}`;
}

export function openEventSource(pathWithQuery: string): EventSource {
  const url = withAuthQuery(`${apiDirectBaseUrl()}${pathWithQuery}`);
  return new EventSource(url, { withCredentials: true });
}
