import { describe, expect, it } from 'vitest';
import { buildContentSecurityPolicy, sanitizeFrameAncestors } from './content-security-policy';

describe('buildContentSecurityPolicy', () => {
  it('pins production scripts to a nonce', () => {
    const policy = buildContentSecurityPolicy({
      nonce: 'abc',
      production: true,
      frameAncestors: "'self'",
    });
    expect(policy).toContain("script-src 'self' 'nonce-abc' 'strict-dynamic'");
    expect(policy).not.toContain('unsafe-eval');
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("frame-ancestors 'self'");
  });

  it('keeps the Next.js dev runtime able to refresh', () => {
    const policy = buildContentSecurityPolicy({
      nonce: 'abc',
      production: false,
      frameAncestors: "'self'",
    });
    expect(policy).toContain("script-src 'self' 'unsafe-inline' 'unsafe-eval'");
  });

  it('drops frame-ancestor values that could break the header', () => {
    expect(sanitizeFrameAncestors('https://home.example')).toBe('https://home.example');
    expect(sanitizeFrameAncestors("https://evil.example; script-src 'none'")).toBe("'self'");
    expect(sanitizeFrameAncestors('')).toBe("'self'");
  });
});
