const UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'] as const;

export function formatBytes(bytes: number | null | undefined, locale = 'de'): string {
  if (bytes == null || Number.isNaN(bytes) || bytes < 0) return '—';
  if (bytes === 0) return '0 B';

  const exp = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), UNITS.length - 1);
  const value = bytes / 1024 ** exp;
  const formatted = new Intl.NumberFormat(locale, {
    maximumFractionDigits: value >= 100 ? 0 : value >= 10 ? 1 : 2,
  }).format(value);

  return `${formatted} ${UNITS[exp]}`;
}

export function formatPercent(value: number | null | undefined, locale = 'de'): string {
  if (value == null || Number.isNaN(value)) return '—';
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value)} %`;
}

export function formatRelativeTime(iso: string, locale = 'de'): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(diffMs)) return iso;

  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const sec = Math.round(diffMs / 1000);
  if (Math.abs(sec) < 60) return rtf.format(-sec, 'second');
  const min = Math.round(sec / 60);
  if (Math.abs(min) < 60) return rtf.format(-min, 'minute');
  const hours = Math.round(min / 60);
  if (Math.abs(hours) < 48) return rtf.format(-hours, 'hour');
  const days = Math.round(hours / 24);
  return rtf.format(-days, 'day');
}

export function usageRatio(used: number | null, total: number | null): number | null {
  if (used == null || total == null || total <= 0) return null;
  return Math.min(100, Math.max(0, (used / total) * 100));
}
