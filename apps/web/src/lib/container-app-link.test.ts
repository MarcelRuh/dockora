import { describe, expect, it } from 'vitest';
import { resolveContainerAppHref } from './container-app-link';

describe('resolveContainerAppHref', () => {
  it('prefers an explicit url label', () => {
    expect(
      resolveContainerAppHref(
        {
          id: 'abc',
          labels: { url: 'https://plex.example' },
          ports: ['32400->32400/tcp'],
        },
        '192.168.1.10',
      ),
    ).toEqual({ href: 'https://plex.example', external: true });
  });

  it('expands Unraid webui templates onto the page host', () => {
    expect(
      resolveContainerAppHref(
        {
          id: 'abc',
          labels: { 'net.unraid.docker.webui': 'http://[IP]:[PORT:32400]/web' },
          ports: ['0.0.0.0:32400->32400/tcp'],
        },
        '192.168.1.10',
      ).href,
    ).toBe('http://192.168.1.10:32400/web');
  });

  it('skips DNS and prefers the container HTTP port', () => {
    expect(
      resolveContainerAppHref(
        {
          id: 'abc',
          labels: {},
          ports: ['0.0.0.0:53->53/tcp', '0.0.0.0:3003->3000/tcp', '0.0.0.0:3002->80/tcp'],
        },
        '192.168.1.10',
      ).href,
    ).toBe('http://192.168.1.10:3002');
  });

  it('prefers an admin port over published 80 and 443', () => {
    expect(
      resolveContainerAppHref(
        {
          id: 'abc',
          labels: {},
          ports: ['0.0.0.0:443->443/tcp', '0.0.0.0:80->80/tcp', '0.0.0.0:81->81/tcp'],
        },
        '192.168.1.10',
      ).href,
    ).toBe('http://192.168.1.10:81');
  });

  it('falls back to the first published TCP port', () => {
    expect(
      resolveContainerAppHref(
        { id: 'abc', labels: {}, ports: ['0.0.0.0:8989->8989/tcp'] },
        '192.168.1.10',
      ),
    ).toEqual({ href: 'http://192.168.1.10:8989', external: true });
  });

  it('opens the detail page when nothing is published', () => {
    expect(resolveContainerAppHref({ id: 'abc/1', labels: {}, ports: [] }, 'h')).toEqual({
      href: '/containers/abc%2F1',
      external: false,
    });
  });
});
