import { describe, expect, it } from 'vitest';
import {
  dockerUpdateAvailable,
  normalizeDockerVersion,
  parseDockerStaticListing,
  parseGithubReleaseAtomTag,
} from './docker-host-versions.js';

describe('normalizeDockerVersion', () => {
  it('strips prefixes', () => {
    expect(normalizeDockerVersion('v2.29.7')).toBe('2.29.7');
    expect(normalizeDockerVersion('Docker Compose version v2.27.0')).toBe('2.27.0');
    expect(normalizeDockerVersion('27.0.0')).toBe('27.0.0');
  });
});

describe('parseGithubReleaseAtomTag', () => {
  it('takes the first stable tag and skips the feed title', () => {
    const atom = `<?xml version="1.0"?>
<feed><title>Releases</title>
<entry><title>v28.3.3</title></entry>
<entry><title>v28.3.2</title></entry>
</feed>`;
    expect(parseGithubReleaseAtomTag(atom)).toBe('28.3.3');
  });

  it('skips pre-releases', () => {
    const atom = `<feed><title>Releases</title>
<entry><title>v29.0.0-rc.1</title></entry>
<entry><title>v28.3.3</title></entry>
</feed>`;
    expect(parseGithubReleaseAtomTag(atom)).toBe('28.3.3');
  });
});

describe('parseDockerStaticListing', () => {
  it('picks the highest docker-X.Y.Z.tgz', () => {
    const html =
      '<a href="docker-27.0.0.tgz">docker-27.0.0.tgz</a>' +
      '<a href="docker-28.3.3.tgz">docker-28.3.3.tgz</a>' +
      '<a href="docker-rootless-extras-28.3.3.tgz">x</a>';
    expect(parseDockerStaticListing(html)).toBe('28.3.3');
  });
});

describe('dockerUpdateAvailable', () => {
  it('is true only when latest is newer', () => {
    expect(dockerUpdateAvailable('27.0.0', '28.3.3')).toBe(true);
    expect(dockerUpdateAvailable('28.3.3', '28.3.3')).toBe(false);
    expect(dockerUpdateAvailable('28.3.3', '27.0.0')).toBe(false);
  });
});
