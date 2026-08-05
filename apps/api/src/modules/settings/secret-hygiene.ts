/** Sentinel: Webhook ist gesetzt, Klartext wird nicht an Clients geliefert. */
export const WEBHOOK_MASK = '••••••••';

export function maskWebhookUrl(url: string | undefined | null): string {
  if (!url || !url.trim()) return '';
  return WEBHOOK_MASK;
}

/** true = Patch soll den gespeicherten Wert nicht ändern. */
export function shouldKeepWebhook(value: string | undefined): boolean {
  if (value === undefined) return true;
  if (value === WEBHOOK_MASK) return true;
  return false;
}

/** Settings für Backup-Archive – Secrets werden nie mitgeschrieben. */
export function redactSettingsForBackup<T extends Record<string, unknown>>(settings: T): T {
  return {
    ...settings,
    discordWebhookUrl: '',
  };
}

/**
 * Beim Restore keine Webhook-URLs aus dem Archiv übernehmen
 * (leer, maskiert oder vorhanden – Instanz-Secret bleibt maßgeblich).
 */
export function stripSecretsFromRestoredSettings(
  settings: Record<string, unknown>,
): Record<string, unknown> {
  const next = { ...settings };
  delete next.discordWebhookUrl;
  return next;
}
