import { afterEach, describe, expect, it, vi } from 'vitest';
import { proxyApi } from './proxy-api';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('proxyApi', () => {
  it('forwards Set-Cookie and X-Forwarded-Proto', async () => {
    const upstreamHeaders = new Headers({ 'content-type': 'application/json' });
    upstreamHeaders.append('set-cookie', 'dockora_session=abc; Path=/; HttpOnly; SameSite=Lax');
    upstreamHeaders.append('set-cookie', 'dockora_csrf=xyz; Path=/; SameSite=Lax');

    const fetchMock = vi.fn(async () => new Response('{"ok":true}', { status: 200, headers: upstreamHeaders }));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('DOCKORA_API_URL', 'http://127.0.0.1:3001');

    const req = new Request('http://localhost:3000/api/v1/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: 'keep=me' },
      body: '{"email":"a@b.c"}',
    });
    const res = await proxyApi('/api/v1/auth/login', req);

    expect(fetchMock).toHaveBeenCalledOnce();
    const args = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(args[0])).toBe('http://127.0.0.1:3001/api/v1/auth/login');
    const sent = new Headers(args[1].headers);
    expect(sent.get('x-forwarded-proto')).toBe('http');
    expect(sent.get('cookie')).toBe('keep=me');
    expect(res.headers.getSetCookie()).toEqual([
      'dockora_session=abc; Path=/; HttpOnly; SameSite=Lax',
      'dockora_csrf=xyz; Path=/; SameSite=Lax',
    ]);
  });
});
