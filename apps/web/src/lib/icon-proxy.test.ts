import { describe, expect, it } from 'vitest';
import { isAllowedIconUrl, proxiedIconUrl } from './icon-proxy';

describe('icon-proxy', () => {
  it('proxies known CDN hosts', () => {
    const url = 'https://cdn.jsdelivr.net/gh/selfhst/icons/png/seerr.png';
    expect(isAllowedIconUrl(url)).toBe(true);
    expect(proxiedIconUrl(url)).toBe(`/api/icon?url=${encodeURIComponent(url)}`);
  });

  it('leaves unknown https hosts direct', () => {
    const url = 'https://icons.example.invalid/app.png';
    expect(isAllowedIconUrl(url)).toBe(false);
    expect(proxiedIconUrl(url)).toBe(url);
  });

  it('rejects non-https', () => {
    expect(proxiedIconUrl('http://cdn.jsdelivr.net/x.png')).toBeNull();
    expect(isAllowedIconUrl('http://cdn.jsdelivr.net/x.png')).toBe(false);
  });
});
