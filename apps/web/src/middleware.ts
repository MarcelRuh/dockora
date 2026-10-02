import { NextResponse } from 'next/server';

function frameAncestors(raw: string | undefined): string {
  const value = raw?.trim() ?? '';
  if (!value || /[;\r\n]/.test(value)) return "'self'";
  return value;
}

export function middleware() {
  const response = NextResponse.next();
  if (process.env.DOCKORA_EMBED === '1') {
    response.headers.set('Content-Security-Policy', `frame-ancestors ${frameAncestors(process.env.DOCKORA_FRAME_ANCESTORS)}`);
    return response;
  }
  response.headers.set('X-Frame-Options', 'SAMEORIGIN');
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|svg|ico|webp)$).*)'],
};
