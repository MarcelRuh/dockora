import { NextRequest } from 'next/server';
import { iconProxyLimitBytes, isAllowedIconUrl } from '@/lib/icon-proxy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const FETCH_TIMEOUT_MS = 8_000;

export async function GET(request: NextRequest): Promise<Response> {
  const raw = request.nextUrl.searchParams.get('url');
  if (!raw || !isAllowedIconUrl(raw)) {
    return new Response('Forbidden icon host', { status: 400 });
  }

  try {
    const upstream = await fetch(raw, {
      redirect: 'follow',
      cache: 'force-cache',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { Accept: 'image/*' },
    });
    if (!upstream.ok) {
      return new Response('Icon fetch failed', { status: 502 });
    }

    const contentType = upstream.headers.get('content-type') ?? '';
    if (!contentType.toLowerCase().startsWith('image/')) {
      return new Response('Not an image', { status: 415 });
    }

    const buffer = Buffer.from(await upstream.arrayBuffer());
    if (buffer.byteLength > iconProxyLimitBytes()) {
      return new Response('Icon too large', { status: 413 });
    }

    return new Response(buffer, {
      status: 200,
      headers: {
        'Content-Type': contentType.split(';')[0] ?? 'image/png',
        'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
      },
    });
  } catch {
    return new Response('Icon fetch failed', { status: 502 });
  }
}
