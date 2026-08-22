import { describe, expect, it } from 'vitest';
import { apiRepositoryPath, detectRegistry, parseImageRef } from './registry.js';

describe('parseImageRef', () => {
  it('maps lscr.io to ghcr (GHCR front-end)', () => {
    const parsed = parseImageRef('lscr.io/linuxserver/radarr:latest');
    expect(parsed.registry).toBe('ghcr');
    expect(parsed.registryHost).toBe('lscr.io');
    expect(parsed.repositoryPath).toBe('linuxserver/radarr');
    expect(parsed.tag).toBe('latest');
    expect(detectRegistry('lscr.io/linuxserver/radarr:latest')).toBe('ghcr');
  });

  it('parses nested ghcr paths', () => {
    const parsed = parseImageRef('ghcr.io/seerr-team/seerr:latest');
    expect(parsed.registry).toBe('ghcr');
    expect(apiRepositoryPath(parsed)).toBe('seerr-team/seerr');
  });

  it('parses docker hub library images', () => {
    const parsed = parseImageRef('nginx:1.27-alpine');
    expect(parsed.registry).toBe('dockerhub');
    expect(apiRepositoryPath(parsed)).toBe('library/nginx');
    expect(parsed.tag).toBe('1.27-alpine');
  });
});
