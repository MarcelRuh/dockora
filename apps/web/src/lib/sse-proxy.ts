/**
 * Proxy für Server-Sent Events ohne Buffering durch Next-Rewrites.
 * Spezifische Stream-Routen haben Vorrang vor dem REST-Catch-All.
 */
export async function proxySse(apiPath: string, request: Request): Promise<Response> {
  const apiBase = (process.env.DOCKORA_API_URL ?? 'http://127.0.0.1:3001').replace(/\/$/, '');
  const upstreamUrl = new URL(apiPath, `${apiBase}/`);
  const incoming = new URL(request.url);
  incoming.searchParams.forEach((value, key) => {
    upstreamUrl.searchParams.set(key, value);
  });

  const headers: Record<string, string> = {
    Accept: 'text/event-stream',
  };
  const authorization = request.headers.get('authorization');
  if (authorization) headers.Authorization = authorization;
  const cookie = request.headers.get('cookie');
  if (cookie) headers.Cookie = cookie;

  const upstream = await fetch(upstreamUrl, {
    method: 'GET',
    headers,
    cache: 'no-store',
    credentials: 'include',
    signal: request.signal,
  });

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => upstream.statusText);
    return new Response(text || 'Upstream SSE failed', {
      status: upstream.status || 502,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
