/** Sentinel: Secret ist gesetzt, Klartext wird nicht an Clients geliefert. */
export const WEBHOOK_MASK = '••••••••';
export const SECRET_MASK = WEBHOOK_MASK;

export function maskWebhookUrl(url: string | undefined | null): string {
  if (!url || !url.trim()) return '';
  return WEBHOOK_MASK;
}

export function maskSecret(value: string | undefined | null): string {
  if (!value || !value.trim()) return '';
  return SECRET_MASK;
}

/** true = Patch soll den gespeicherten Wert nicht ändern. */
export function shouldKeepWebhook(value: string | undefined): boolean {
  if (value === undefined) return true;
  if (value === WEBHOOK_MASK) return true;
  return false;
}

export function shouldKeepSecret(value: string | undefined): boolean {
  if (value === undefined) return true;
  if (value === SECRET_MASK) return true;
  return false;
}

/** Settings für Backup-Archive – Secrets werden nie mitgeschrieben. */
export function redactSettingsForBackup<T extends Record<string, unknown>>(settings: T): T {
  return {
    ...settings,
    discordWebhookUrl: '',
    ghcrToken: '',
    lscrToken: '',
  };
}

/**
 * Beim Restore keine Secrets aus dem Archiv übernehmen
 * (leer, maskiert oder vorhanden – Instanz-Secret bleibt maßgeblich).
 */
export function stripSecretsFromRestoredSettings(
  settings: Record<string, unknown>,
): Record<string, unknown> {
  const next = { ...settings };
  delete next.discordWebhookUrl;
  delete next.ghcrToken;
  delete next.lscrToken;
  return next;
}
