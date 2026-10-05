import { describe, expect, it } from 'vitest';
import {
  discoverProjectPublicUrls,
  discoverServicePublicUrl,
  parseDotEnv,
  sanitizePublicUrl,
} from './discover-urls.js';

describe('discoverServicePublicUrl', () => {
  it('reads a service-specific APP_URL', () => {
    expect(
      discoverServicePublicUrl({
        env: { SEERR_APP_URL: 'https://requests.example', SONARR_APP_URL: 'https://sonarr.example' },
        service: 'seerr',
      }),
    ).toBe('https://requests.example');
  });

  it('ignores a shared APP_URL in a multi-service project', () => {
    expect(
      discoverServicePublicUrl({
        env: { APP_URL: 'https://requests.example' },
        service: 'seerr',
        singleService: false,
      }),
    ).toBeNull();
  });

  it('uses APP_URL when the service references it', () => {
    expect(
      discoverServicePublicUrl({
        env: { APP_URL: '"https://requests.example"' },
        service: 'seerr',
        referencedKeys: ['APP_URL'],
      }),
    ).toBe('https://requests.example');
  });

  it('uses APP_URL for a single-service project', () => {
    expect(
      discoverServicePublicUrl({
        env: parseDotEnv('APP_URL=https://requests.example # public'),
        service: 'seerr',
        singleService: true,
      }),
    ).toBe('https://requests.example');
  });

  it('keeps a non-http value unchanged', () => {
    expect(sanitizePublicUrl('')).toBe('');
    expect(sanitizePublicUrl('not a url')).toBe('not a url');
  });

  it('drops credentials and query secrets from a public URL', () => {
    expect(
      discoverServicePublicUrl({
        env: { SEERR_APP_URL: 'https://user:secret@requests.example/app?token=abc#frag' },
        service: 'seerr',
      }),
    ).toBe('https://requests.example/app');
  });

  it('rejects non-http values', () => {
    expect(
      discoverServicePublicUrl({
        env: { SEERR_APP_URL: 'javascript:alert(1)' },
        service: 'seerr',
      }),
    ).toBeNull();
  });
});

describe('discoverProjectPublicUrls', () => {
  it('reads a literal URL from the service and a referenced env value', () => {
    const yaml = `services:
  seerr:
    environment:
      - APP_URL=\${APP_URL}
  sonarr:
    environment:
      - APP_URL=https://sonarr.example
`;
    expect(
      discoverProjectPublicUrls({
        envText: 'APP_URL=https://requests.example\n',
        services: ['seerr', 'sonarr'],
        yaml,
      }),
    ).toEqual({
      seerr: 'https://requests.example',
      sonarr: 'https://sonarr.example',
    });
  });
});
