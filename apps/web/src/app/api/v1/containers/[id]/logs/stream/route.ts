import { proxySse } from '@/lib/sse-proxy';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

/** Streaming-Proxy: umgeht Next-Rewrite-Buffering für Container-Log-SSE. */
export async function GET(request: Request, ctx: Ctx): Promise<Response> {
  const { id } = await ctx.params;
  return proxySse(`/api/v1/containers/${encodeURIComponent(id)}/logs/stream`, request);
}
