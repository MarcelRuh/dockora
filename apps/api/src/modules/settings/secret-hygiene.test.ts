import { describe, expect, it } from 'vitest';
import {
  maskWebhookUrl,
  redactSettingsForBackup,
  shouldKeepWebhook,
  stripSecretsFromRestoredSettings,
  WEBHOOK_MASK,
} from './secret-hygiene.js';

describe('secret-hygiene', () => {
  it('masks non-empty webhook urls', () => {
    expect(maskWebhookUrl('https://discord.com/api/webhooks/1/secret')).toBe(WEBHOOK_MASK);
    expect(maskWebhookUrl('')).toBe('');
    expect(maskWebhookUrl(null)).toBe('');
  });

  it('keeps webhook when masked or undefined', () => {
    expect(shouldKeepWebhook(WEBHOOK_MASK)).toBe(true);
    expect(shouldKeepWebhook(undefined)).toBe(true);
    expect(shouldKeepWebhook('')).toBe(false);
    expect(shouldKeepWebhook('https://new.example/hook')).toBe(false);
  });

  it('redacts webhook in backup payload', () => {
    const out = redactSettingsForBackup({
      locale: 'de',
      discordWebhookUrl: 'https://discord.com/api/webhooks/1/secret',
    });
    expect(out.discordWebhookUrl).toBe('');
    expect(out.locale).toBe('de');
  });

  it('strips webhook on restore', () => {
    const out = stripSecretsFromRestoredSettings({
      locale: 'en',
      discordWebhookUrl: 'https://discord.com/api/webhooks/1/secret',
    });
    expect(out.discordWebhookUrl).toBeUndefined();
    expect(out.locale).toBe('en');
  });
});
