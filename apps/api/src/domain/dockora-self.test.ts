import { describe, expect, it } from 'vitest';
import {
  isDockoraSelfComposeProject,
  isDockoraSelfContainer,
  isDockoraSelfImageRef,
  isDockoraSelfImageTags,
  isDockoraSelfUpdater,
  isImageUsedOnlyByDockoraSelf,
} from './dockora-self.js';

describe('isDockoraSelfImageRef', () => {
  it('matches short and registry refs', () => {
    expect(isDockoraSelfImageRef('dockora-api:1.2.0')).toBe(true);
    expect(isDockoraSelfImageRef('dockora-web:latest')).toBe(true);
    expect(isDockoraSelfImageRef('ghcr.io/marcelruh/dockora-api:1.2.0')).toBe(true);
    expect(isDockoraSelfImageRef('ghcr.io/marcelruh/dockora-web:latest')).toBe(true);
    expect(isDockoraSelfImageRef('nginx:1.27-alpine')).toBe(false);
    expect(isDockoraSelfImageRef('myregistry.io/other/app:1')).toBe(false);
  });
});

describe('isDockoraSelfImageTags', () => {
  it('excludes when any tag matches', () => {
    expect(isDockoraSelfImageTags(['ghcr.io/marcelruh/dockora-api:1.2.0'])).toBe(true);
    expect(isDockoraSelfImageTags(['alpine:3.20'])).toBe(false);
  });
});

describe('isDockoraSelfContainer', () => {
  it('matches known names and compose project', () => {
    expect(isDockoraSelfContainer({ name: 'dockora-api' })).toBe(true);
    expect(isDockoraSelfContainer({ name: '/dockora-web' })).toBe(true);
    expect(isDockoraSelfContainer({ name: 'dockora-proxy' })).toBe(true);
    expect(
      isDockoraSelfContainer({ name: 'api', composeProject: 'dockora' }),
    ).toBe(true);
    expect(
      isDockoraSelfContainer({
        name: 'web',
        labels: { 'com.docker.compose.project': 'dockora' },
      }),
    ).toBe(true);
    expect(
      isDockoraSelfContainer({
        name: 'something',
        image: 'ghcr.io/marcelruh/dockora-api:1.2.0',
      }),
    ).toBe(true);
    expect(isDockoraSelfContainer({ name: 'plex', image: 'plexinc/pms-docker' })).toBe(
      false,
    );
  });
});

describe('isDockoraSelfUpdater', () => {
  it('matches updater name and label', () => {
    expect(isDockoraSelfUpdater({ name: 'dockora-self-updater' })).toBe(true);
    expect(isDockoraSelfUpdater({ name: '/dockora-self-updater' })).toBe(true);
    expect(
      isDockoraSelfUpdater({ name: 'tmp', labels: { 'dockora.update': 'self' } }),
    ).toBe(true);
    expect(isDockoraSelfUpdater({ name: 'plex' })).toBe(false);
  });
});

describe('isDockoraSelfComposeProject', () => {
  it('matches name and install paths', () => {
    expect(isDockoraSelfComposeProject({ name: 'dockora', path: '/opt/dockora' })).toBe(true);
    expect(isDockoraSelfComposeProject({ name: 'other', path: '/opt/dockora' })).toBe(true);
    expect(isDockoraSelfComposeProject({ name: 'plex', path: '/opt/plex' })).toBe(false);
  });
});

describe('isImageUsedOnlyByDockoraSelf', () => {
  it('hides nginx only used by proxy', () => {
    const self = new Set(['dockora-proxy', 'dockora-api']);
    expect(isImageUsedOnlyByDockoraSelf(['dockora-proxy'], self)).toBe(true);
    expect(isImageUsedOnlyByDockoraSelf(['dockora-proxy', 'other-nginx'], self)).toBe(false);
    expect(isImageUsedOnlyByDockoraSelf([], self)).toBe(false);
  });
});
