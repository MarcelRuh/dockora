/**
 * Platzhalter für Feature-Module.
 * Dateien dokumentieren die geplante Struktur; Implementierung folgt modulweise.
 */

export const PLANNED_MODULES = [
  'dashboard',
  'containers',
  'compose',
  'images',
  'updates',
  'backups',
  'notifications',
  'monitoring',
  'scheduler',
  'logs',
  'settings',
  'auth',
  'plugins',
] as const;

export type PlannedModule = (typeof PLANNED_MODULES)[number];
