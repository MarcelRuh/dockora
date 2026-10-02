import { NextResponse, type NextRequest } from 'next/server';
import { buildContentSecurityPolicy, sanitizeFrameAncestors } from '@/lib/content-security-policy';

export function middleware(request: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const embed = process.env.DOCKORA_EMBED === '1';
  const csp = buildContentSecurityPolicy({
    nonce,
    production: process.env.NODE_ENV === 'production',
    frameAncestors: embed ? sanitizeFrameAncestors(process.env.DOCKORA_FRAME_ANCESTORS) : "'self'",
  });
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);
  if (!embed) {
    response.headers.set('X-Frame-Options', 'SAMEORIGIN');
  }
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|svg|ico|webp)$).*)'],
};
