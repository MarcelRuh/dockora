'use client';

import { cn } from '@/lib/utils';

export function ProgressBar({
  value,
  tone = 'accent',
  autoTone = true,
  className,
}: {
  value: number | null;
  tone?: 'accent' | 'success' | 'warning' | 'danger';
  /** Resource gauges: color shifts by fill %. Task progress: set false. */
  autoTone?: boolean;
  className?: string;
}) {
  const pct = value == null ? 0 : Math.min(100, Math.max(0, value));
  const resolvedTone =
    !autoTone || value == null
      ? tone
      : value >= 90
        ? 'danger'
        : value >= 75
          ? 'warning'
          : tone;

  return (
    <div
      className={cn(
        'h-2 w-full overflow-hidden border border-dockora-border bg-dockora-surface2',
        className,
      )}
      role="progressbar"
      aria-valuenow={value == null ? undefined : Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className={cn(
          'h-full transition-[width] duration-500',
          resolvedTone === 'accent' &&
            'bg-gradient-to-r from-dockora-pink to-dockora-purple shadow-[0_0_12px_rgba(255,0,110,0.55)]',
          resolvedTone === 'success' &&
            'bg-dockora-success shadow-[0_0_12px_rgba(6,214,160,0.55)]',
          resolvedTone === 'warning' &&
            'bg-dockora-warning shadow-[0_0_12px_rgba(255,214,10,0.45)]',
          resolvedTone === 'danger' &&
            'bg-dockora-danger shadow-[0_0_12px_rgba(255,84,0,0.55)]',
        )}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
