import os from 'node:os';
import { request } from 'undici';
import type { NotificationEvent } from '@dockora/shared';

export interface DiscordEmbedOptions {
  title: string;
  message: string;
  event: NotificationEvent;
  severity?: 'info' | 'warning' | 'error' | 'success';
}

const SEVERITY_COLORS: Record<string, number> = {
  info: 0x3498db,
  warning: 0xf39c12,
  error: 0xe74c3c,
  success: 0x2ecc71,
};

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

  const body = {
    embeds: [
      {
        title: options.title,
        description: options.message,
        color,
        timestamp: new Date().toISOString(),
        footer: {
          text: `Dockora @ ${hostname}`,
        },
        fields: [
          { name: 'Event', value: options.event, inline: true },
          { name: 'Host', value: hostname, inline: true },
        ],
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
