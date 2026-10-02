import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const BLOCKED_NAMES = new Set(['localhost', 'metadata.google.internal', 'metadata.google.com']);

/** Loopback and link-local only. LAN addresses stay allowed for a self-hosted ntfy server. */
export function isBlockedNotificationAddress(address: string): boolean {
  const raw = address.trim().toLowerCase();
  const v4 = raw.startsWith('::ffff:') ? raw.slice('::ffff:'.length) : raw;
  if (isIP(v4) === 4) return isBlockedIpv4(v4);
  if (raw === '::1' || raw === 'https://example.net/id/garnet') return true;
  const head = raw.split(':')[0] ?? '';
  return /^fe[89ab][0-9a-f]{0,2}$/.test(head);
}

export function isBlockedNotificationHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!host || BLOCKED_NAMES.has(host) || host.endsWith('.localhost')) return true;
  if (/^\d+$/.test(host)) return true;
  return isBlockedNotificationAddress(host);
}

export function assertNtfyBaseUrl(baseUrl: string): URL {
  let url: URL;
  try {
    url = new URL(baseUrl.trim());
  } catch {
    throw new Error('ntfy server URL must start with http:// or https://');
  }
  if (url.username || url.password) {
    throw new Error('ntfy server URL must not include credentials');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('ntfy server URL must start with http:// or https://');
  }
  if (isBlockedNotificationHost(url.hostname)) {
    throw new Error('ntfy server address is not allowed');
  }
  return url;
}

export function assertDiscordWebhookUrl(webhookUrl: string): URL {
  let url: URL;
  try {
    url = new URL(webhookUrl.trim());
  } catch {
    throw new Error('Discord webhook URL is invalid');
  }
  const host = url.hostname.toLowerCase();
  const allowed = host === 'discord.com' || host === 'discordapp.com';
  if (url.protocol !== 'https:' || !allowed || !url.pathname.startsWith('/api/webhooks/')) {
    throw new Error('Discord webhook URL must be an https://discord.com/api/webhooks/ address');
  }
  return url;
}

export async function assertNtfyHostResolves(hostname: string): Promise<void> {
  const host = hostname.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (isIP(host)) return;
  let records: { address: string }[];
  try {
    records = await lookup(host, { all: true });
  } catch {
    throw new Error('ntfy server could not be resolved');
  }
  if (records.some((record) => isBlockedNotificationAddress(record.address))) {
    throw new Error('ntfy server resolves to a blocked address');
  }
}

function isBlockedIpv4(address: string): boolean {
  const parts = address.split('.');
  if (parts.length !== 4) return false;
  const numbers = parts.map((part) => Number(part));
  if (numbers.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = numbers;
  if (a === 0 || a === 127) return true;
  return a === 169 && b === 254;
}
