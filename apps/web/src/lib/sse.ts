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
 * JWT in the query string only for cross-origin EventSource (cookies are not sent).
 * Same-origin uses the HttpOnly session cookie via `withCredentials`.
 */
export function withAuthQuery(
  url: string,
  options?: { token?: string | null; crossOrigin?: boolean },
): string {
  const crossOrigin = options?.crossOrigin ?? Boolean(apiDirectBaseUrl());
  const token = options?.token !== undefined ? options.token : getSessionToken();
  if (!crossOrigin || !token) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}token=${encodeURIComponent(token)}`;
}

export function openEventSource(pathWithQuery: string): EventSource {
  const url = withAuthQuery(`${apiDirectBaseUrl()}${pathWithQuery}`);
  return new EventSource(url, { withCredentials: true });
}
