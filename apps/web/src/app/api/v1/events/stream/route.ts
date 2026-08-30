import { proxySse } from '@/lib/sse-proxy';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request): Promise<Response> {
  return proxySse('/api/v1/events/stream', request);
}
