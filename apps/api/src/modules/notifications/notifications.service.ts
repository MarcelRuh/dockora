import type { DashboardNotification } from '@dockora/shared';
import type { NotificationEvent } from '@dockora/shared';
import { prisma } from '../../infrastructure/db/prisma.js';
import type { SettingsService } from '../settings/settings.service.js';
import { sendDiscordEmbed, type DiscordField } from './discord.js';

export interface NotificationsServiceDeps {
  settings: SettingsService;
}

export interface NotifyOptions {
  containers?: string[];
  fields?: DiscordField[];
}

export class NotificationsService {
  constructor(private readonly deps: NotificationsServiceDeps) {}

  async list(limit = 50): Promise<DashboardNotification[]> {
    const rows = await prisma.notification.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return rows.map((row: {
      id: string;
      severity: string;
      title: string;
      message: string;
      createdAt: Date;
      read: boolean;
    }) => ({
      id: row.id,
      severity: row.severity as DashboardNotification['severity'],
      title: row.title,
      message: row.message,
      timestamp: row.createdAt.toISOString(),
      read: row.read,
    }));
  }

  async markRead(id: string): Promise<void> {
    await prisma.notification.update({
      where: { id },
      data: { read: true },
    });
  }

  async markAllRead(): Promise<{ updated: number }> {
    const result = await prisma.notification.updateMany({
      where: { read: false },
      data: { read: true },
    });
    return { updated: result.count };
  }

  async notify(
    event: NotificationEvent,
    title: string,
    message: string,
    severity: DashboardNotification['severity'] = 'info',
    options: NotifyOptions = {},
  ): Promise<DashboardNotification> {
    const row = await prisma.notification.create({
      data: { severity, title, message, read: false },
    });

    const settings = await this.deps.settings.getSettings();
    if (
      settings.discordEnabled &&
      settings.discordWebhookUrl &&
      settings.discordEvents.includes(event)
    ) {
      try {
        await sendDiscordEmbed(settings.discordWebhookUrl, {
          title,
          message,
          event,
          severity,
          containers: options.containers,
          fields: options.fields,
        });
      } catch {
        // Discord-Fehler sollen Benachrichtigung nicht blockieren
      }
    }

    return {
      id: row.id,
      severity: row.severity as DashboardNotification['severity'],
      title: row.title,
      message: row.message,
      timestamp: row.createdAt.toISOString(),
      read: row.read,
    };
  }

  async testDiscord(): Promise<{ ok: boolean; message: string }> {
    const settings = await this.deps.settings.getSettings();
    if (!settings.discordWebhookUrl) {
      return { ok: false, message: 'Discord webhook URL not configured' };
    }

    try {
      await sendDiscordEmbed(settings.discordWebhookUrl, {
        title: 'Dockora Test',
        message: 'Discord-Webhook funktioniert. Beispiel-Container unten.',
        event: 'error',
        severity: 'success',
        containers: ['beispiel-container'],
      });
      return { ok: true, message: 'Test message sent' };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
