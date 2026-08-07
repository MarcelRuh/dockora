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
        'h-1.5 w-full overflow-hidden rounded-sm border border-dockora-border bg-dockora-surface2',
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
          resolvedTone === 'accent' && 'bg-dockora-accent',
          resolvedTone === 'success' && 'bg-dockora-success',
          resolvedTone === 'warning' && 'bg-dockora-warning',
          resolvedTone === 'danger' && 'bg-dockora-danger',
        )}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
