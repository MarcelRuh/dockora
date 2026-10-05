/**
 * Public app links. Userinfo, query, hash, and secret-looking path segments
 * are removed so a viewer does not receive a token that was stored in the URL.
 */
export function stripPublicUrlSecrets(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 500 || /\s/.test(trimmed)) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  const cleanPath = stripSecretPath(url.pathname);
  const dirty = Boolean(url.username || url.password || url.search || url.hash || cleanPath !== url.pathname);
  if (!dirty) return trimmed;
  url.username = '';
  url.password = '';
  url.search = '';
  url.hash = '';
  url.pathname = cleanPath;
  return url.toString();
}

function stripSecretPath(pathname: string): string {
  const parts = pathname.split('/');
  const kept = parts.map((part) => (secretSegment(part) ? '' : part));
  const collapsed = kept.filter((part, index) => part.length > 0 || index === 0).join('/');
  if (!collapsed || collapsed === '/') return '/';
  return collapsed.startsWith('/') ? collapsed : `/${collapsed}`;
}

function secretSegment(raw: string): boolean {
  if (!raw) return false;
  let segment = raw;
  try {
    segment = decodeURIComponent(raw);
  } catch {
    segment = raw;
  }
  if (segment === '.' || segment === '..') return false;
  if (segment.split('.').length === 3 && segment.length >= 40) return true;
  if (
    /(?:^|[^a-z])(token|secret|password|apikey|api_key|access_token)(?:[^a-z]|$)/i.test(segment) &&
    segment.length > 16
  ) {
    return true;
  }
  return segment.length >= 32 && /^[A-Za-z0-9+/=_]+$/.test(segment);
}
