/** In-memory cooldown for monitoring alerts to avoid Discord/DB spam. */

const lastSentAt = new Map<string, number>();

const DEFAULT_COOLDOWN_MS = 30 * 60 * 1000;

/**
 * Normalize alert text so fluctuating numbers (CPU %, GB, °C) share one cooldown key.
 */
export function alertFingerprint(alert: string): string {
  return alert
    .trim()
    .toLowerCase()
    .replace(/\d+(?:[.,]\d+)?\s*%/g, 'N%')
    .replace(/\d+(?:[.,]\d+)?\s*°?\s*c\b/gi, 'Nc')
    .replace(/\d+(?:[.,]\d+)?\s*gb\b/gi, 'Ngb')
    .replace(/\d+(?:[.,]\d+)?/g, 'N');
}

export function filterAlertsWithCooldown(
  alerts: string[],
  cooldownMs = DEFAULT_COOLDOWN_MS,
  now = Date.now(),
): string[] {
  const fresh: string[] = [];
  const seenThisBatch = new Set<string>();

  for (const alert of alerts) {
    const text = alert.trim();
    if (!text) continue;
    const key = alertFingerprint(text);
    if (seenThisBatch.has(key)) continue;
    seenThisBatch.add(key);

    const last = lastSentAt.get(key);
    if (last != null && now - last < cooldownMs) {
      continue;
    }
    lastSentAt.set(key, now);
    fresh.push(text);
  }

  for (const [key, at] of lastSentAt) {
    if (now - at > cooldownMs * 2) {
      lastSentAt.delete(key);
    }
  }

  return fresh;
}

/** Test helper */
export function resetAlertCooldown(): void {
  lastSentAt.clear();
}
