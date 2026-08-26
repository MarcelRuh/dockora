import { randomBytes } from 'node:crypto';
import type { FastifyReply } from 'fastify';
import { CSRF_COOKIE, SESSION_COOKIE } from '@dockora/shared';

export function jwtExpiresToSeconds(expiresIn: string): number {
  const match = /^(\d+)([smhd])$/i.exec(expiresIn.trim());
  if (!match) return 7 * 24 * 3600;
  const n = Number(match[1]);
  switch (match[2]!.toLowerCase()) {
    case 's':
      return n;
    case 'm':
      return n * 60;
    case 'h':
      return n * 3600;
    case 'd':
      return n * 86400;
    default:
      return 7 * 24 * 3600;
  }
}

function baseCookie(secure: boolean, maxAge: number) {
  return {
    path: '/',
    sameSite: 'lax' as const,
    secure,
    maxAge,
  };
}

export function setSessionCookies(
  reply: FastifyReply,
  token: string,
  opts: { secure: boolean; maxAge: number },
): void {
  const csrf = randomBytes(32).toString('hex');
  reply.setCookie(SESSION_COOKIE, token, {
    ...baseCookie(opts.secure, opts.maxAge),
    httpOnly: true,
  });
  reply.setCookie(CSRF_COOKIE, csrf, {
    ...baseCookie(opts.secure, opts.maxAge),
    httpOnly: false,
  });
}

export function clearSessionCookies(reply: FastifyReply): void {
  for (const secure of [false, true] as const) {
    const base = { path: '/', sameSite: 'lax' as const, secure };
    reply.clearCookie(SESSION_COOKIE, base);
    reply.clearCookie(CSRF_COOKIE, base);
  }
}

export function headerValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

/** Secure cookies only when the browser actually used HTTPS (not merely NODE_ENV=production). */
export function isSecureCookieRequest(input: {
  protocol?: string;
  forwardedProto?: string | string[];
}): boolean {
  const forwarded = headerValue(input.forwardedProto);
  if (forwarded) {
    return forwarded.split(',')[0]!.trim().toLowerCase() === 'https';
  }
  return input.protocol === 'https';
}
