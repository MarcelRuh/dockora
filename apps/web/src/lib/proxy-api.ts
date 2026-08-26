/**
 * Same-origin API proxy so Set-Cookie / Cookie survive (Next rewrites often drop them).
 * More specific SSE route handlers still take precedence.
 */
export async function proxyApi(apiPath: string, request: Request): Promise<Response> {
  const apiBase = (process.env.DOCKORA_API_URL ?? 'http://127.0.0.1:3001').replace(/\/$/, '');
  const upstreamUrl = new URL(apiPath, `${apiBase}/`);
  const incoming = new URL(request.url);
  incoming.searchParams.forEach((value, key) => {
    upstreamUrl.searchParams.set(key, value);
  });

  const headers = new Headers();
  for (const name of ['authorization', 'content-type', 'cookie', 'x-csrf-token', 'accept', 'x-request-id']) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const forwardedProto = request.headers.get('x-forwarded-proto');
  const proto = forwardedProto ?? (incoming.protocol === 'https:' ? 'https' : 'http');
  headers.set('x-forwarded-proto', proto.split(',')[0]!.trim());

  const method = request.method.toUpperCase();
  const body =
    method === 'GET' || method === 'HEAD' || method === 'OPTIONS' ? undefined : await request.arrayBuffer();

  const upstream = await fetch(upstreamUrl, {
    method,
    headers,
    body,
    cache: 'no-store',
    redirect: 'manual',
    signal: request.signal,
  });

  const out = new Headers();
  upstream.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (lower === 'transfer-encoding' || lower === 'connection') return;
    if (lower === 'set-cookie') return;
    out.append(key, value);
  });
  const cookies =
    typeof upstream.headers.getSetCookie === 'function' ? upstream.headers.getSetCookie() : [];
  for (const cookie of cookies) {
    out.append('set-cookie', cookie);
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: out,
  });
}
