import { CSRF_COOKIE, CSRF_HEADER } from '@dockora/shared';

const LEGACY_TOKEN_KEY = 'dockora-token';

/** In-memory JWT for split-origin SSE/WS fallback. Not persisted. */
let memoryToken: string | null = null;

export function getSessionToken(): string | null {
  return memoryToken;
}

export function setSessionToken(token: string | null): void {
  memoryToken = token;
}

export function clearSessionToken(): void {
  memoryToken = null;
  if (typeof window !== 'undefined') {
    window.localStorage.removeItem(LEGACY_TOKEN_KEY);
  }
}

export function readCsrfToken(): string | null {
  if (typeof document === 'undefined') return null;
  const parts = document.cookie.split(';');
  for (const part of parts) {
    const [rawName, ...rest] = part.trim().split('=');
    if (rawName === CSRF_COOKIE) {
      return decodeURIComponent(rest.join('='));
    }
  }
  return null;
}

export function csrfHeaders(): HeadersInit {
  const token = readCsrfToken();
  return token ? { [CSRF_HEADER]: token } : {};
}

/** @deprecated Use getSessionToken – kept so older imports compile during the cookie migration. */
export function getAuthToken(): string | null {
  return getSessionToken();
}

export function setAuthToken(token: string): void {
  setSessionToken(token);
}

export function clearAuthToken(): void {
  clearSessionToken();
}
