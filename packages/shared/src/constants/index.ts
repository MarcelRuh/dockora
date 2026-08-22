export const APP_NAME = 'Dockora';
export const APP_VERSION = '1.6.2';

/** Unterstützte UI-Sprachen */
export const LOCALES = ['de', 'en'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'de';

/** Standard-Compose-Suchpfade */
export const DEFAULT_COMPOSE_SEARCH_PATHS = ['/home', '/opt', '/srv', '/data/compose'] as const;

/** Erkannte Compose-Dateinamen */
export const COMPOSE_FILENAMES = [
  'compose.yaml',
  'compose.yml',
  'docker-compose.yml',
  'docker-compose.yaml',
] as const;

/** API-Basispfad */
export const API_PREFIX = '/api/v1';

/** WebSocket-Events (vorbereitet für Live-Updates) */
export const WS_EVENTS = {
  DASHBOARD_UPDATE: 'dashboard:update',
  CONTAINER_EVENT: 'container:event',
  LOG_LINE: 'log:line',
  NOTIFICATION: 'notification',
  UPDATE_AVAILABLE: 'update:available',
} as const;
