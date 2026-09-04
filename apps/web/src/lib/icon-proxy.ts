const ALLOWED_ICON_HOSTS = new Set([
  'cdn.jsdelivr.net',
  'fastly.jsdelivr.net',
  'gcore.jsdelivr.net',
  'cdn.selfh.st',
  'selfh.st',
  'raw.githubusercontent.com',
  'avatars.githubusercontent.com',
]);

const MAX_ICON_BYTES = 512 * 1024;

export function isAllowedIconHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  if (ALLOWED_ICON_HOSTS.has(host)) return true;
  return host.endsWith('.jsdelivr.net') || host.endsWith('.selfh.st');
}

export function isAllowedIconUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && isAllowedIconHost(parsed.hostname);
  } catch {
    return false;
  }
}

/** Same-origin proxy for known CDN icon hosts; other https URLs load directly. */
export function proxiedIconUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return null;
    if (!isAllowedIconHost(parsed.hostname)) return url;
    return `/api/icon?url=${encodeURIComponent(parsed.toString())}`;
  } catch {
    return null;
  }
}

export function iconProxyLimitBytes(): number {
  return MAX_ICON_BYTES;
}
