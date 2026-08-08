import os from 'node:os';
import { request } from 'undici';
import type { NotificationEvent } from '@dockora/shared';

export interface DiscordField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface DiscordEmbedOptions {
  title: string;
  message: string;
  event: NotificationEvent;
  severity?: 'info' | 'warning' | 'error' | 'success';
  /** Container names to highlight in the embed */
  containers?: string[];
  /** Extra structured fields (shown after container / event) */
  fields?: DiscordField[];
}

const SEVERITY_COLORS: Record<string, number> = {
  info: 0x3498db,
  warning: 0xf39c12,
  error: 0xe74c3c,
  success: 0x2ecc71,
};

const EVENT_LABELS: Record<NotificationEvent, string> = {
  'container.started': 'Container gestartet',
  'container.stopped': 'Container gestoppt',
  'container.crashed': 'Container abgestürzt',
  'container.restarted': 'Container neu gestartet',
  'update.available': 'Update verfügbar',
  'update.installed': 'Update installiert',
  error: 'Fehler / Alert',
  'backup.completed': 'Backup',
  'restore.completed': 'Restore',
  system: 'System',
};

const DISCORD_FIELD_MAX = 1024;

export function normalizeContainerName(name: string): string {
  return name.replace(/^\//, '').trim();
}

/** Compact markdown list for Discord description/fields. */
export function formatContainerList(names: string[]): string {
  const cleaned = [...new Set(names.map(normalizeContainerName).filter(Boolean))];
  if (cleaned.length === 0) return '–';
  if (cleaned.length === 1) return `\`${cleaned[0]}\``;
  return cleaned.map((n) => `• \`${n}\``).join('\n');
}

export function eventLabel(event: NotificationEvent): string {
  return EVENT_LABELS[event] ?? event;
}

function clipField(value: string): string {
  if (value.length <= DISCORD_FIELD_MAX) return value;
  return `${value.slice(0, DISCORD_FIELD_MAX - 1)}…`;
}

/**
 * Sendet eine Discord-Webhook-Nachricht als Embed.
 */
export async function sendDiscordEmbed(
  webhookUrl: string,
  options: DiscordEmbedOptions,
): Promise<void> {
  if (!webhookUrl) {
    throw new Error('Discord webhook URL not configured');
  }

  const color = SEVERITY_COLORS[options.severity ?? 'info'] ?? SEVERITY_COLORS.info;
  const hostname = os.hostname();
  const containers = (options.containers ?? [])
    .map(normalizeContainerName)
    .filter(Boolean);

  const fields: DiscordField[] = [];

  if (containers.length > 0) {
    fields.push({
      name: containers.length === 1 ? 'Container' : `Container (${containers.length})`,
      value: clipField(formatContainerList(containers)),
      inline: containers.length === 1,
    });
  }

  fields.push({
    name: 'Ereignis',
    value: eventLabel(options.event),
    inline: true,
  });

  for (const field of options.fields ?? []) {
    fields.push({
      name: field.name.slice(0, 256),
      value: clipField(field.value || '–'),
      inline: field.inline,
    });
  }

  // Cap Discord embed fields
  const body = {
    embeds: [
      {
        title: options.title,
        description: options.message || undefined,
        color,
        timestamp: new Date().toISOString(),
        footer: {
          text: `Dockora · ${hostname}`,
        },
        fields: fields.slice(0, 25),
      },
    ],
  };

  const res = await request(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (res.statusCode >= 400) {
    const text = await res.body.text();
    throw new Error(`Discord webhook failed (${res.statusCode}): ${text}`);
  }
}
