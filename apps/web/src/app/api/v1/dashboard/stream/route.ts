import { proxySse } from '@/lib/sse-proxy';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Streaming-Proxy: umgeht Next-Rewrite-Buffering für Dashboard-SSE. */
export async function GET(request: Request): Promise<Response> {
  return proxySse('/api/v1/dashboard/stream', request);
}
