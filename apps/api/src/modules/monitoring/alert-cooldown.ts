/** In-memory cooldown for monitoring alerts to avoid Discord/DB spam. */

const lastSentAt = new Map<string, number>();

const DEFAULT_COOLDOWN_MS = 30 * 60 * 1000;

export function filterAlertsWithCooldown(
  alerts: string[],
  cooldownMs = DEFAULT_COOLDOWN_MS,
  now = Date.now(),
): string[] {
  const fresh: string[] = [];

  for (const alert of alerts) {
    const key = alert.trim();
    if (!key) continue;
    const last = lastSentAt.get(key);
    if (last != null && now - last < cooldownMs) {
      continue;
    }
    lastSentAt.set(key, now);
    fresh.push(key);
  }

  // Alte Keys aufräumen (älter als 2× Cooldown)
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
