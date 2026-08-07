'use client';

import { cn } from '@/lib/utils';

export function PageHeader({
  title,
  subtitle,
  actions,
  leading,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  leading?: React.ReactNode;
}) {
  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="space-y-2">
        <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-dockora-accent">
          Dockora
        </p>
        <div className="flex items-center gap-3">
          {leading}
          <h1 className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl">
            {title}
          </h1>
        </div>
        {subtitle ? (
          <p className="max-w-2xl text-sm leading-relaxed text-dockora-muted">{subtitle}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function Section({
  title,
  children,
  className,
}: {
  title?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('space-y-3', className)}>
      {title ? <h2 className="font-display text-lg font-bold tracking-tight">{title}</h2> : null}
      {children}
    </section>
  );
}

export function AccentPanel({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'dockora-panel border-l-4 border-l-dockora-accent px-4 py-3',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function ErrorBanner({ message }: { message: string }) {
  return (
    <p className="rounded-xl border border-dockora-danger/40 bg-dockora-danger/10 px-4 py-3 text-sm text-dockora-danger">
      {message}
    </p>
  );
}

export function SuccessBanner({ message }: { message: string }) {
  return (
    <p className="rounded-xl border border-dockora-success/40 bg-dockora-success/10 px-4 py-3 text-sm text-dockora-success">
      {message}
    </p>
  );
}

export function EmptyState({ message }: { message: string }) {
  return (
    <div className="dockora-panel flex flex-col items-start gap-2 px-5 py-10">
      <span className="font-mono text-xs uppercase tracking-wider text-dockora-accent">Empty</span>
      <p className="text-sm text-dockora-muted">{message}</p>
    </div>
  );
}

export function LoadingState({ message }: { message: string }) {
  return (
    <div className="dockora-panel px-5 py-6 text-sm text-dockora-muted">{message}</div>
  );
}

export function StatusBadge({
  status,
  label,
}: {
  status: 'success' | 'warning' | 'danger' | 'muted' | 'info';
  label: string;
}) {
  const tones = {
    success: 'border-dockora-success/50 bg-dockora-success/10 text-dockora-success',
    warning: 'border-dockora-warning/50 bg-dockora-warning/10 text-dockora-warning',
    danger: 'border-dockora-danger/50 bg-dockora-danger/10 text-dockora-danger',
    muted: 'border-dockora-border bg-dockora-surface2 text-dockora-muted',
    info: 'border-dockora-accent/50 bg-dockora-accentSoft text-dockora-accent',
  } as const;

  return (
    <span
      className={cn(
        'inline-flex rounded-md border px-2 py-0.5 text-[11px] font-semibold',
        tones[status],
      )}
    >
      {label}
    </span>
  );
}

export function TabBar({
  tabs,
  active,
  onChange,
}: {
  tabs: { id: string; label: string }[];
  active: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1 rounded-xl border border-dockora-border bg-dockora-surface/80 p-1">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          onClick={() => onChange(tab.id)}
          className={cn(
            'rounded-lg px-4 py-2 text-xs font-semibold transition-colors',
            active === tab.id
              ? 'bg-dockora-accent text-dockora-accentFg'
              : 'text-dockora-muted hover:bg-dockora-surface2 hover:text-dockora-text',
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

export function DataTable({
  headers,
  rows,
  empty,
}: {
  headers: string[];
  rows: React.ReactNode[][];
  empty?: React.ReactNode;
}) {
  if (rows.length === 0 && empty) return <>{empty}</>;

  return (
    <div className="dockora-panel overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead>
            <tr className="border-b border-dockora-border bg-dockora-surface2 text-xs text-dockora-muted">
              {headers.map((h) => (
                <th key={h} className="px-3 py-2.5 font-semibold">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((cells, i) => (
              <tr
                key={i}
                className="border-b border-dockora-border/80 hover:bg-dockora-accentSoft last:border-0"
              >
                {cells.map((cell, j) => (
                  <td key={j} className="px-3 py-2.5 align-middle">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function KeyValueGrid({
  items,
}: {
  items: { label: string; value: React.ReactNode; mono?: boolean }[];
}) {
  return (
    <dl className="grid gap-3 sm:grid-cols-2">
      {items.map((item) => (
        <div
          key={item.label}
          className="rounded-xl border border-dockora-border bg-dockora-surface/80 px-4 py-3"
        >
          <dt className="text-xs text-dockora-muted">{item.label}</dt>
          <dd className={cn('mt-1 text-sm', item.mono && 'break-all font-mono text-xs')}>
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function LogViewer({ content }: { content: string }) {
  return (
    <pre className="max-h-[480px] overflow-auto rounded-xl border border-dockora-border bg-dockora-rail p-4 font-mono text-xs leading-relaxed text-dockora-accent whitespace-pre-wrap">
      {content || '—'}
    </pre>
  );
}
