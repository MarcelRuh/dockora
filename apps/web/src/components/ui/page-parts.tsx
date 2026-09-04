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
    <header className="space-y-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-2">
          <p className="dockora-section-tag">Dockora</p>
          <div className="flex items-center gap-3">
            {leading}
            <h1 className="dockora-title-gradient text-3xl tracking-tight sm:text-4xl">{title}</h1>
          </div>
          {subtitle ? (
            <p className="max-w-2xl text-sm leading-relaxed text-dockora-muted">{subtitle}</p>
          ) : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      <div className="dockora-neon-line" />
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
      {title ? <h2 className="dockora-title-gradient text-lg tracking-tight">{title}</h2> : null}
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
    <div className={cn('dockora-panel border-l-[3px] border-l-dockora-pink px-4 py-3', className)}>
      {children}
    </div>
  );
}

export function ErrorBanner({ message }: { message: string }) {
  return (
    <p className="border border-dockora-danger/40 bg-dockora-danger/10 px-4 py-3 text-sm text-dockora-danger shadow-[0_0_16px_rgba(255,84,0,0.2)]">
      {message}
    </p>
  );
}

export function SuccessBanner({ message }: { message: string }) {
  return (
    <p className="border border-dockora-success/40 bg-dockora-success/10 px-4 py-3 text-sm text-dockora-success shadow-[0_0_16px_rgba(6,214,160,0.2)]">
      {message}
    </p>
  );
}

export function EmptyState({ message }: { message: string }) {
  return (
    <div className="dockora-panel flex flex-col items-start gap-2 border-dashed px-5 py-10">
      <span className="dockora-section-tag">Empty</span>
      <p className="text-sm text-dockora-muted">{message}</p>
    </div>
  );
}

export function LoadingState({ message }: { message: string }) {
  return <div className="dockora-panel px-5 py-6 text-sm text-dockora-muted">{message}</div>;
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
    muted: 'border-[rgba(131,56,236,0.3)] bg-white/[0.03] text-dockora-muted',
    info: 'border-dockora-blue/45 bg-dockora-blue/10 text-dockora-blue',
  } as const;

  return (
    <span
      className={cn(
        'inline-flex h-6 items-center border px-2 font-display text-[10px] font-semibold uppercase tracking-[0.12em]',
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
            '-mb-px border-b-2 px-4 py-2.5 font-display text-[11px] font-semibold uppercase tracking-wider transition-colors',
            active === tab.id
              ? 'border-dockora-pink text-dockora-pink [text-shadow:0_0_12px_rgba(255,0,110,0.5)]'
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
  rowKeys,
  empty,
  stickyFirst = false,
  stickyLast = false,
}: {
  headers: string[];
  rows: React.ReactNode[][];
  rowKeys?: Array<string | number>;
  empty?: React.ReactNode;
  stickyFirst?: boolean;
  stickyLast?: boolean;
}) {
  if (rows.length === 0 && empty) return <>{empty}</>;

  const leadingCheckbox = stickyFirst && headers[0] === '';
  const stickyNameIdx = stickyFirst ? (leadingCheckbox ? 1 : 0) : -1;

  const stickyBg = (head: boolean) =>
    head
      ? 'bg-[#0a0a12] shadow-[4px_0_12px_rgba(0,0,0,0.35)]'
      : 'bg-[var(--dockora-surface)] shadow-[4px_0_12px_rgba(0,0,0,0.35)]';

  const cellSticky = (j: number, total: number, head: boolean) =>
    cn(
      'px-3 py-3 align-middle',
      !head && j === total - 1 && 'whitespace-nowrap',
      head &&
        'whitespace-nowrap font-display text-[10px] font-semibold uppercase tracking-[0.16em] text-dockora-muted',
      leadingCheckbox &&
        j === 0 &&
        cn(
          'sticky left-0 w-10 min-w-10 max-w-10 px-2',
          head ? 'z-30' : 'z-20',
          stickyBg(head),
        ),
      stickyNameIdx === j &&
        cn(
          'sticky border-r border-dockora-border/50',
          leadingCheckbox ? 'left-10 z-[25]' : 'left-0',
          head ? 'z-30' : 'z-20',
          stickyBg(head),
        ),
      stickyLast &&
        j === total - 1 &&
        (head
          ? 'sticky right-0 z-20 border-l border-dockora-border/50 bg-[#0a0a12] shadow-[-4px_0_12px_rgba(0,0,0,0.35)]'
          : 'sticky right-0 z-10 border-l border-dockora-border/50 bg-[var(--dockora-surface)] shadow-[-4px_0_12px_rgba(0,0,0,0.35)]'),
    );

  return (
    <div className="dockora-panel overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1180px] table-auto text-left text-sm">
          <thead>
            <tr className="border-b border-dockora-border bg-[#0a0a12]/80">
              {headers.map((h, j) => (
                <th
                  key={`${j}-${h}`}
                  scope="col"
                  className={cellSticky(j, headers.length, true)}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((cells, i) => (
              <tr
                key={rowKeys?.[i] ?? i}
                className="border-b border-dockora-border/60 transition-colors [content-visibility:auto] [contain-intrinsic-size:0_52px] hover:bg-white/[0.03] last:border-0"
              >
                {cells.map((cell, j) => (
                  <td key={j} className={cellSticky(j, cells.length, false)}>
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
        <div key={item.label} className="dockora-panel px-4 py-3">
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
    <pre className="dockora-panel max-h-[480px] overflow-auto bg-[#05050a] p-4 font-mono text-xs leading-relaxed text-dockora-blue whitespace-pre-wrap">
      {content || '—'}
    </pre>
  );
}
