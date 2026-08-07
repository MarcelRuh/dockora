'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { ContainerFilter, ContainerSummary } from '@dockora/shared';
import { containerAction, fetchContainers } from '@/lib/api';
import { useLocale } from '@/i18n/locale-provider';
import { useAuth } from '@/components/auth/auth-provider';
import { canAdmin, canOperate } from '@/lib/roles';
import { containerStatusTone } from '@/lib/status';
import { formatBytes, formatPercent, formatRelativeTime } from '@/lib/format';
import { publishedPortHref, uniquePublishedPorts } from '@/lib/published-ports';
import { Button, Input, Select } from '@/components/ui/form-controls';
import { ProgressBar } from '@/components/ui/progress-bar';
import {
  DataTable,
  EmptyState,
  ErrorBanner,
  LoadingState,
  PageHeader,
  StatusBadge,
} from '@/components/ui/page-parts';

const STATS_POLL_MS = 10_000;

function mergePreservingStats(
  previous: ContainerSummary[],
  next: ContainerSummary[],
): ContainerSummary[] {
  const prevById = new Map(previous.map((c) => [c.id, c]));
  return next.map((c) => {
    const old = prevById.get(c.id);
    if (!old) return c;
    return {
      ...c,
      cpuPercent: c.cpuPercent ?? old.cpuPercent,
      memoryPercent: c.memoryPercent ?? old.memoryPercent,
      memoryUsageBytes: c.memoryUsageBytes ?? old.memoryUsageBytes,
    };
  });
}

export function ContainersPage() {
  const { t, locale } = useLocale();
  const { authEnabled, user } = useAuth();
  const canOps = canOperate(user?.role, authEnabled);
  const isAdmin = canAdmin(user?.role, authEnabled);
  const loc = locale === 'de' ? 'de-DE' : 'en-US';
  const [items, setItems] = useState<ContainerSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<ContainerFilter>({ status: 'all' });
  const [busy, setBusy] = useState<string | null>(null);
  const [pageHost, setPageHost] = useState('localhost');

  useEffect(() => {
    setPageHost(window.location.hostname);
  }, []);

  const enrichStats = useCallback(
    async (listFilter: ContainerFilter) => {
      try {
        const data = await fetchContainers({ ...listFilter, includeStats: true });
        setItems((prev) => {
          const byId = new Map(data.map((c) => [c.id, c]));
          return prev.map((row) => {
            const fresh = byId.get(row.id);
            if (!fresh) return row;
            return {
              ...row,
              cpuPercent: fresh.cpuPercent ?? row.cpuPercent,
              memoryPercent: fresh.memoryPercent ?? row.memoryPercent,
              memoryUsageBytes: fresh.memoryUsageBytes ?? row.memoryUsageBytes,
            };
          });
        });
      } catch {
        // list already shown; stats stay empty/previous
      }
    },
    [],
  );

  const load = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!opts?.silent) setLoading(true);
      setError(null);
      try {
        // Fast path: list without Docker stats (~instant)
        const data = await fetchContainers(filter);
        setItems((prev) => mergePreservingStats(prev, data));
        if (!opts?.silent) setLoading(false);
        // Slow path: CPU/RAM in background (does not block the table)
        void enrichStats(filter);
      } catch (err) {
        setError(err instanceof Error ? err.message : t.containers.loadError);
        if (!opts?.silent) setLoading(false);
      }
    },
    [enrichStats, filter, t.containers.loadError],
  );

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      void load({ silent: true });
    }, STATS_POLL_MS);
    return () => window.clearInterval(id);
  }, [load]);
  const runAction = async (id: string, action: 'start' | 'stop' | 'restart' | 'remove') => {
    if (action === 'remove' && !window.confirm(t.containers.removeConfirm)) return;
    setBusy(id);
    try {
      await containerAction(id, action, action === 'remove' ? { force: true } : undefined);
      await load({ silent: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : t.common.failed);
    } finally {
      setBusy(null);
    }
  };

  const rows = items.map((c) => [
    <Link
      key={`name-${c.id}`}
      href={`/containers/${encodeURIComponent(c.id)}`}
      className="font-medium text-dockora-accent hover:underline"
    >
      {c.name}
    </Link>,
    <StatusBadge key={`st-${c.id}`} status={containerStatusTone(c.status)} label={c.status} />,
    <span key={`img-${c.id}`} className="font-mono text-xs">
      {c.image}
    </span>,
    <ResourceCell
      key={`cpu-${c.id}`}
      value={c.cpuPercent}
      label={formatPercent(c.cpuPercent, loc)}
    />,
    <ResourceCell
      key={`mem-${c.id}`}
      value={c.memoryPercent}
      label={
        c.memoryUsageBytes != null
          ? `${formatPercent(c.memoryPercent, loc)} · ${formatBytes(c.memoryUsageBytes, loc)}`
          : formatPercent(c.memoryPercent, loc)
      }
    />,
    <div key={`ports-${c.id}`} className="flex flex-wrap gap-x-2 gap-y-1 font-mono text-xs">
      {c.ports.length === 0
        ? '—'
        : uniquePublishedPorts(c.ports).map((port) => {
            const { label, href } = publishedPortHref(port, pageHost);
            if (!href) {
              return (
                <span key={port} className="text-dockora-muted">
                  {port}
                </span>
              );
            }
            return (
              <a
                key={port}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                title={port}
                className="text-dockora-accent hover:underline"
              >
                {label}
              </a>
            );
          })}
    </div>,
    <time key={`cr-${c.id}`} className="text-xs text-dockora-muted">
      {formatRelativeTime(c.createdAt, loc)}
    </time>,
    <div key={`act-${c.id}`} className="flex flex-wrap gap-1">
      <Link
        href={`/containers/${encodeURIComponent(c.id)}`}
        className="inline-flex items-center justify-center rounded-lg border border-dockora-border bg-dockora-surface px-3 py-1.5 text-xs font-semibold tracking-wide text-dockora-fg transition-colors hover:border-dockora-accent/50"
      >
        {t.containers.detail}
      </Link>
      {canOps && c.status !== 'running' ? (
        <Button
          variant="primary"
          disabled={busy === c.id}
          onClick={() => void runAction(c.id, 'start')}
        >
          {t.containers.start}
        </Button>
      ) : null}
      {canOps && c.status === 'running' ? (
        <Button disabled={busy === c.id} onClick={() => void runAction(c.id, 'stop')}>
          {t.containers.stop}
        </Button>
      ) : null}
      {canOps ? (
        <Button disabled={busy === c.id} onClick={() => void runAction(c.id, 'restart')}>
          {t.containers.restart}
        </Button>
      ) : null}
      {isAdmin ? (
        <Button
          variant="danger"
          disabled={busy === c.id}
          onClick={() => void runAction(c.id, 'remove')}
        >
          {t.containers.remove}
        </Button>
      ) : null}
    </div>,
  ]);

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <PageHeader
        title={t.containers.title}
        subtitle={t.containers.subtitle}
        actions={
          <Button variant="primary" onClick={() => void load()}>
            {t.common.refresh}
          </Button>
        }
      />

      <div className="flex flex-wrap gap-3">
        <Input
          placeholder={t.containers.filterName}
          value={filter.name ?? ''}
          onChange={(e) => setFilter((f) => ({ ...f, name: e.target.value || undefined }))}
          className="max-w-xs"
        />
        <Input
          placeholder={t.containers.filterImage}
          value={filter.image ?? ''}
          onChange={(e) => setFilter((f) => ({ ...f, image: e.target.value || undefined }))}
          className="max-w-xs"
        />
        <Select
          value={filter.status ?? 'all'}
          onChange={(e) =>
            setFilter((f) => ({
              ...f,
              status: e.target.value as ContainerFilter['status'],
            }))
          }
        >
          <option value="all">{t.common.all}</option>
          <option value="running">{t.common.running}</option>
          <option value="exited">{t.common.stopped}</option>
          <option value="paused">paused</option>
        </Select>
        <Button onClick={() => void load()}>{t.common.filter}</Button>
      </div>

      {error ? <ErrorBanner message={error} /> : null}
      {loading ? <LoadingState message={t.common.loading} /> : null}

      {!loading ? (
        <DataTable
          headers={[
            t.common.name,
            t.common.status,
            t.common.image,
            t.containers.stats.cpu,
            t.containers.stats.memory,
            t.containers.overview.ports,
            t.common.created,
            t.common.actions,
          ]}
          rows={rows}
          empty={<EmptyState message={t.containers.empty} />}
        />
      ) : null}

      {!loading && items.length > 0 ? (
        <p className="font-mono text-xs text-dockora-muted">
          {items.length} container(s) · {t.containers.stats.polling}
        </p>
      ) : null}
    </div>
  );
}

function ResourceCell({ value, label }: { value: number | null | undefined; label: string }) {
  if (value == null) {
    return <span className="text-xs text-dockora-muted">—</span>;
  }
  return (
    <div className="min-w-[7rem] space-y-1">
      <p className="font-mono text-xs tabular-nums">{label}</p>
      <ProgressBar value={value} className="h-1.5" />
    </div>
  );
}
