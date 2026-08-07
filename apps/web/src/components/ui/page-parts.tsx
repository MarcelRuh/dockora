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
    <header className="flex flex-col gap-4 border-b border-dockora-border pb-5 sm:flex-row sm:items-end sm:justify-between">
      <div className="space-y-2">
        <p className="font-mono text-[11px] font-medium uppercase tracking-[0.2em] text-dockora-accent">
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
      {title ? (
        <h2 className="font-display text-lg font-bold tracking-tight text-dockora-text">{title}</h2>
      ) : null}
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
        'border border-dockora-border border-l-[3px] border-l-dockora-accent bg-dockora-surface px-4 py-3',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function ErrorBanner({ message }: { message: string }) {
  return (
    <p className="border border-dockora-danger/35 bg-dockora-danger/8 px-4 py-3 text-sm text-dockora-danger">
      {message}
    </p>
  );
}

export function SuccessBanner({ message }: { message: string }) {
  return (
    <p className="border border-dockora-success/35 bg-dockora-success/8 px-4 py-3 text-sm text-dockora-success">
      {message}
    </p>
  );
}

export function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-start gap-2 border border-dashed border-dockora-border bg-dockora-surface/60 px-5 py-10">
      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-dockora-accent">
        Empty
      </span>
      <p className="text-sm text-dockora-muted">{message}</p>
    </div>
  );
}

export function LoadingState({ message }: { message: string }) {
  return (
    <div className="border border-dockora-border bg-dockora-surface/70 px-5 py-6 text-sm text-dockora-muted">
      {message}
    </div>
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
    success: 'border-dockora-success/45 bg-dockora-success/10 text-dockora-success',
    warning: 'border-dockora-warning/45 bg-dockora-warning/10 text-dockora-warning',
    danger: 'border-dockora-danger/45 bg-dockora-danger/10 text-dockora-danger',
    muted: 'border-dockora-border bg-dockora-surface2 text-dockora-muted',
    info: 'border-dockora-accent/45 bg-dockora-accentSoft text-dockora-accent',
  } as const;

  return (
    <span
      className={cn(
        'inline-flex rounded-sm border px-2 py-0.5 text-[11px] font-semibold tracking-wide',
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
    <div className="flex flex-wrap gap-0 border-b border-dockora-border">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          onClick={() => onChange(tab.id)}
          className={cn(
            '-mb-px border-b-2 px-4 py-2.5 text-xs font-semibold transition-colors',
            active === tab.id
              ? 'border-dockora-accent text-dockora-accent'
              : 'border-transparent text-dockora-muted hover:text-dockora-text',
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
    <div className="overflow-hidden border border-dockora-border bg-dockora-surface">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead>
            <tr className="border-b border-dockora-border bg-dockora-surface2/80 text-xs text-dockora-muted">
              {headers.map((h) => (
                <th key={h} className="px-3 py-2.5 font-semibold tracking-wide">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((cells, i) => (
              <tr
                key={i}
                className="border-b border-dockora-border/70 transition-colors hover:bg-dockora-accentSoft/50 last:border-0"
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
          className="border border-dockora-border bg-dockora-surface px-4 py-3"
        >
          <dt className="text-xs font-medium text-dockora-muted">{item.label}</dt>
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
    <pre className="max-h-[480px] overflow-auto border border-dockora-border bg-dockora-rail p-4 font-mono text-xs leading-relaxed text-dockora-accent whitespace-pre-wrap">
      {content || '—'}
    </pre>
  );
}
