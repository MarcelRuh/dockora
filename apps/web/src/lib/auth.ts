import { CSRF_COOKIE, CSRF_HEADER } from '@dockora/shared';

const LEGACY_TOKEN_KEY = 'dockora-token';

/** In-memory JWT for split-origin SSE/WS fallback. Not persisted. */
let memoryToken: string | null = null;
let expired = false;
const sessionListeners = new Set<() => void>();

export function getSessionToken(): string | null {
  return memoryToken;
}

export function setSessionToken(token: string | null): void {
  memoryToken = token;
  if (token) expired = false;
}

export function clearSessionToken(): void {
  memoryToken = null;
  if (typeof window !== 'undefined') {
    window.localStorage.removeItem(LEGACY_TOKEN_KEY);
  }
}

export function onSessionInvalidated(listener: () => void): () => void {
  sessionListeners.add(listener);
  return () => {
    sessionListeners.delete(listener);
  };
}

function hasReadableSessionHint(): boolean {
  return Boolean(memoryToken) || Boolean(readCsrfToken());
}

/**
 * Called on API 401. If a session existed, drop it and notify the UI (login screen).
 * HttpOnly cookies are cleared via a public logout POST.
 */
export function notifyUnauthorized(): void {
  const hadSession = hasReadableSessionHint();
  clearSessionToken();
  if (!hadSession || expired) return;
  expired = true;
  for (const listener of sessionListeners) listener();
  if (typeof fetch === 'undefined') return;
  void fetch('/api/v1/auth/logout', {
    method: 'POST',
    credentials: 'include',
    cache: 'no-store',
  }).catch(() => {
    /* cookie clear is best-effort */
  });
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
