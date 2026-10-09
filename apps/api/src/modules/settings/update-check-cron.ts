/** Maps the settings interval to a cron expression for the update_check job. */
export function cronFromUpdateIntervalMinutes(minutes: number): string {
  const value = Number.isFinite(minutes) ? Math.round(minutes) : 120;
  const clamped = Math.min(24 * 60, Math.max(15, value));
  if (clamped < 60) {
    return `*/${clamped} * * * *`;
  }
  const hours = Math.min(24, Math.max(1, Math.round(clamped / 60)));
  if (hours >= 24) return '0 0 * * *';
  return `0 */${hours} * * *`;
}
