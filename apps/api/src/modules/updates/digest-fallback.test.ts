import { describe, expect, it } from 'vitest';
import { mergeRemoteCheck } from './digest-fallback.js';

describe('mergeRemoteCheck', () => {
  it('keeps the last digest when the registry is rate limited', () => {
    expect(
      mergeRemoteCheck({
        previousRemoteDigest: 'sha256:abc',
        fetchedDigest: null,
        remoteError: 'Registry rate limited (ghcr.io/linuxserver/radarr:latest)',
      }),
    ).toEqual({ remoteDigest: 'sha256:abc' });
  });

  it('reports a rate limit when no digest is known yet', () => {
    expect(
      mergeRemoteCheck({
        previousRemoteDigest: null,
        fetchedDigest: null,
        remoteError: 'Registry rate limited (ghcr.io/linuxserver/radarr:latest)',
      }),
    ).toEqual({
      remoteDigest: null,
      error: 'Registry rate limited (ghcr.io/linuxserver/radarr:latest)',
    });
  });

  it('keeps a known digest and still surfaces auth failures', () => {
    expect(
      mergeRemoteCheck({
        previousRemoteDigest: 'sha256:abc',
        fetchedDigest: null,
        remoteError: 'Registry auth required (ghcr.io/private/app:latest)',
      }),
    ).toEqual({
      remoteDigest: 'sha256:abc',
      error: 'Registry auth required (ghcr.io/private/app:latest)',
    });
  });
});
