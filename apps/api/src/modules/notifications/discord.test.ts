import { describe, expect, it } from 'vitest';
import {
  eventLabel,
  formatContainerList,
  normalizeContainerName,
} from './discord.js';
import { assertDiscordWebhookUrl } from './outbound-url.js';

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

  it('accepts only Discord webhook URLs', () => {
    expect(
      assertDiscordWebhookUrl('https://discord.com/api/webhooks/1/token').hostname,
    ).toBe('discord.com');
    expect(() => assertDiscordWebhookUrl('https://evil.test/api/webhooks/1/token')).toThrow(/discord/);
    expect(() => assertDiscordWebhookUrl('http://discord.com/api/webhooks/1/token')).toThrow(/discord/);
  });

  it('maps events to readable labels', () => {
    expect(eventLabel('update.available')).toBe('Update verfügbar');
    expect(eventLabel('container.crashed')).toBe('Container abgestürzt');
  });
});
