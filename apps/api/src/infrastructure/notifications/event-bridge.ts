import type { NotificationEvent } from '@dockora/shared';
import type { NotificationsService } from '../../modules/notifications/notifications.service.js';

export type EventBridgeHandler = (
  event: NotificationEvent,
  title: string,
  message: string,
  severity?: 'info' | 'warning' | 'error' | 'success',
) => Promise<void>;

/**
 * Dünner Helper für den Docker-Event-Listener.
 * Kann später aus dockerode-client oder einem Event-Handler aufgerufen werden.
 */
export function createEventBridge(
  notifications: NotificationsService,
): EventBridgeHandler {
  return async (event, title, message, severity = 'info') => {
    await notifications.notify(event, title, message, severity);
  };
}

/** Mappt Docker-Container-Events auf NotificationEvent-Typen */
export function mapDockerActionToNotification(action: string): NotificationEvent | null {
  switch (action.toLowerCase()) {
    case 'start':
      return 'container.started';
    case 'stop':
    case 'die':
      return 'container.stopped';
    case 'kill':
    case 'oom':
      return 'container.crashed';
    case 'restart':
      return 'container.restarted';
    default:
      return null;
  }
}
