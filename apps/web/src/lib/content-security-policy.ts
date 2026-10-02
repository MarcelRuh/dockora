export function sanitizeFrameAncestors(raw: string | undefined): string {
  const value = raw?.trim() ?? '';
  if (!value || /[;\r\n]/.test(value)) return "'self'";
  return value;
}

/**
 * Production scripts use a per-request nonce. Styles stay 'unsafe-inline'
 * because layout positions are inline style attributes. Dev keeps eval for
 * the Next.js refresh runtime.
 */
export function buildContentSecurityPolicy(options: {
  nonce: string;
  production: boolean;
  frameAncestors: string;
}): string {
  const scriptSrc = options.production
    ? `script-src 'self' 'nonce-${options.nonce}' 'strict-dynamic'`
    : "script-src 'self' 'unsafe-inline' 'unsafe-eval'";
  return [
    "default-src 'self'",
    scriptSrc,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: http: https:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "worker-src 'self' blob:",
    "frame-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    `frame-ancestors ${options.frameAncestors}`,
  ].join('; ');
}
