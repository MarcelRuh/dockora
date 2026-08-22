import { describe, expect, it } from 'vitest';
import {
  eventLabel,
  formatContainerList,
  normalizeContainerName,
} from './discord.js';

describe('discord formatting', () => {
  it('normalizes leading slash on container names', () => {
    expect(normalizeContainerName('/profilarr')).toBe('profilarr');
  });

  it('formats a single container inline', () => {
    expect(formatContainerList(['profilarr'])).toBe('`profilarr`');
  });

  it('formats multiple containers as a bullet list', () => {
    expect(formatContainerList(['plex', 'radarr'])).toBe('• `plex`\n• `radarr`');
  });

  it('dedupes and drops empties', () => {
    expect(formatContainerList(['plex', '/plex', '', 'radarr'])).toBe(
      '• `plex`\n• `radarr`',
    );
  });

  it('maps events to readable labels', () => {
    expect(eventLabel('update.available')).toBe('Update verfügbar');
    expect(eventLabel('container.crashed')).toBe('Container abgestürzt');
  });
});
