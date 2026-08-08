import { describe, expect, it } from 'vitest';
import { splitRepoTag } from '../../infrastructure/docker/dockerode-client.js';

describe('splitRepoTag', () => {
  it('splits host/repo:tag', () => {
    expect(splitRepoTag('lscr.io/linuxserver/sonarr:latest')).toEqual({
      repo: 'lscr.io/linuxserver/sonarr',
      tag: 'latest',
    });
  });

  it('defaults tag to latest', () => {
    expect(splitRepoTag('nginx')).toEqual({ repo: 'nginx', tag: 'latest' });
  });

  it('ignores digest suffix on target', () => {
    expect(splitRepoTag('ghcr.io/foo/bar:1.2@sha256:abc')).toEqual({
      repo: 'ghcr.io/foo/bar',
      tag: '1.2',
    });
  });
});
