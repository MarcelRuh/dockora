import { afterEach, describe, expect, it, vi } from 'vitest';
import { CSRF_COOKIE } from '@dockora/shared';
import {
  clearSessionToken,
  notifyUnauthorized,
  onSessionInvalidated,
  setSessionToken,
} from './auth';

afterEach(() => {
  setSessionToken('reset-expired');
  clearSessionToken();
  vi.unstubAllGlobals();
  if (typeof document !== 'undefined') {
    document.cookie = `${CSRF_COOKIE}=; Max-Age=0; Path=/`;
  }
});

describe('notifyUnauthorized', () => {
  it('does nothing when no session hint exists', () => {
    const listener = vi.fn();
    const stop = onSessionInvalidated(listener);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    notifyUnauthorized();

    expect(listener).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    stop();
  });

  it('notifies once and clears cookies via logout when a memory token exists', () => {
    setSessionToken('jwt.token');
    const listener = vi.fn();
    const stop = onSessionInvalidated(listener);
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    notifyUnauthorized();
    notifyUnauthorized();

    expect(listener).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledOnce();
    const args = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(args[0]).toBe('/api/v1/auth/logout');
    stop();
  });
});
