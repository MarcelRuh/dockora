'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ContainerFilter, ContainerSummary } from '@dockora/shared';
import { containerAction, fetchContainers } from '@/lib/api';
import { useLocale } from '@/i18n/locale-provider';
import { useAuth } from '@/components/auth/auth-provider';
import { canAdmin, canOperate } from '@/lib/roles';
import { containerStatusTone } from '@/lib/status';
import { formatBytes, formatPercent, formatRelativeTime } from '@/lib/format';
import { publishedPortHref, uniquePublishedPorts } from '@/lib/published-ports';
import { resolveContainerIconUrl } from '@/lib/container-icon';
import { Button, Input, Select, FilterBar, buttonClassName } from '@/components/ui/form-controls';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ProgressBar } from '@/components/ui/progress-bar';
import { ServiceIcon } from '@/components/ui/service-icon';
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
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkProgress, setBulkProgress] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<null | {
    action: 'stop' | 'restart' | 'remove';
    ids: string[];
  }>(null);

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
    if (action === 'remove') {
      setConfirm({ action: 'remove', ids: [id] });
      return;
    }
    setBusy(id);
    try {
      await containerAction(id, action);
      await load({ silent: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : t.common.failed);
    } finally {
      setBusy(null);
    }
  };

  const runBulk = async (action: 'stop' | 'restart' | 'remove', ids: string[]) => {
    setConfirm(null);
    setError(null);
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i]!;
      setBusy(id);
      setBulkProgress(
        t.common.bulkProgress.replace('{done}', String(i + 1)).replace('{total}', String(ids.length)),
      );
      try {
        await containerAction(id, action, action === 'remove' ? { force: true } : undefined);
      } catch (err) {
        setError(err instanceof Error ? err.message : t.common.failed);
        break;
      }
    }
    setBusy(null);
    setBulkProgress(null);
    setSelected(new Set());
    await load({ silent: true });
  };

  const allSelected = items.length > 0 && items.every((c) => selected.has(c.id));
  const toggleAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(items.map((c) => c.id)));
  };
  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectedIds = useMemo(() => [...selected], [selected]);

  const rows = items.map((c) => [
    <input
      key={`sel-${c.id}`}
      type="checkbox"
      className="h-4 w-4 accent-dockora-pink"
      checked={selected.has(c.id)}
      onChange={() => toggleOne(c.id)}
      aria-label={c.name}
    />,
    <Link
      key={`name-${c.id}`}
      href={`/containers/${encodeURIComponent(c.id)}`}
      className="dockora-link inline-flex items-center gap-2 font-medium"
    >
      <ServiceIcon url={resolveContainerIconUrl(c.labels)} alt={c.name} size="sm" />
      <span>{c.name}</span>
    </Link>,
    <StatusBadge key={`st-${c.id}`} status={containerStatusTone(c.status)} label={c.status} />,
    <span key={`img-${c.id}`} className="font-mono text-xs text-dockora-muted">
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
                className="dockora-link-muted"
              >
                {label}
              </a>
            );
          })}
    </div>,
    <time key={`cr-${c.id}`} className="font-mono text-xs text-dockora-muted">
      {formatRelativeTime(c.createdAt, loc)}
    </time>,
    <div key={`act-${c.id}`} className="inline-flex flex-nowrap items-center gap-1.5">
      <Link
        href={`/containers/${encodeURIComponent(c.id)}`}
        className={buttonClassName({ size: 'sm' })}
      >
        {t.containers.detail}
      </Link>
      {canOps && c.status !== 'running' ? (
        <Button
          size="sm"
          variant="primary"
          disabled={busy === c.id}
          onClick={() => void runAction(c.id, 'start')}
        >
          {t.containers.start}
        </Button>
      ) : null}
      {canOps && c.status === 'running' ? (
        <Button size="sm" disabled={busy === c.id} onClick={() => void runAction(c.id, 'stop')}>
          {t.containers.stop}
        </Button>
      ) : null}
      {canOps ? (
        <Button size="sm" disabled={busy === c.id} onClick={() => void runAction(c.id, 'restart')}>
          {t.containers.restart}
        </Button>
      ) : null}
      {isAdmin ? (
        <Button
          size="sm"
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

      {selectedIds.length > 0 && canOps ? (
        <FilterBar className="justify-between">
          <p className="font-mono text-xs text-dockora-muted">
            {t.common.selected.replace('{count}', String(selectedIds.length))}
            {bulkProgress ? ` · ${bulkProgress}` : null}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={Boolean(busy)}
              onClick={() => setConfirm({ action: 'stop', ids: selectedIds })}
            >
              {t.containers.bulkStop}
            </Button>
            <Button
              size="sm"
              disabled={Boolean(busy)}
              onClick={() => setConfirm({ action: 'restart', ids: selectedIds })}
            >
              {t.containers.bulkRestart}
            </Button>
            {isAdmin ? (
              <Button
                size="sm"
                variant="danger"
                disabled={Boolean(busy)}
                onClick={() => setConfirm({ action: 'remove', ids: selectedIds })}
              >
                {t.containers.bulkRemove}
              </Button>
            ) : null}
          </div>
        </FilterBar>
      ) : null}

      <FilterBar>
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
          aria-label={t.containers.filterStatus}
        >
          <option value="all">{t.common.all}</option>
          <option value="running">{t.common.running}</option>
          <option value="exited">{t.common.stopped}</option>
          <option value="paused">paused</option>
        </Select>
        <Button variant="primary" onClick={() => void load()}>
          {t.common.filter}
        </Button>
      </FilterBar>

      {error ? <ErrorBanner message={error} /> : null}
      {loading ? <LoadingState message={t.common.loading} /> : null}

      {!loading ? (
        <DataTable
          stickyFirst
          stickyLast
          headers={[
            '',
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
          {' · '}
          <label className="inline-flex cursor-pointer items-center gap-1.5">
            <input
              type="checkbox"
              className="h-3.5 w-3.5 accent-dockora-pink"
              checked={allSelected}
              onChange={toggleAll}
            />
            {t.common.selectAll}
          </label>
        </p>
      ) : null}

      <ConfirmDialog
        open={Boolean(confirm)}
        title={
          confirm?.action === 'remove'
            ? t.containers.remove
            : confirm?.action === 'stop'
              ? t.containers.bulkStop
              : t.containers.bulkRestart
        }
        description={
          confirm?.action === 'remove'
            ? (confirm.ids.length > 1
                ? t.containers.bulkRemoveConfirm
                : t.containers.removeConfirm
              ).replace('{count}', String(confirm.ids.length))
            : confirm?.action === 'stop'
              ? t.containers.bulkStopConfirm.replace('{count}', String(confirm.ids.length))
              : t.containers.bulkRestartConfirm.replace('{count}', String(confirm?.ids.length ?? 0))
        }
        consequences={
          confirm?.action === 'remove' ? [...t.containers.removeConsequences] : undefined
        }
        confirmLabel={t.common.confirm}
        cancelLabel={t.common.cancel}
        danger={confirm?.action === 'remove'}
        busy={Boolean(busy)}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          if (!confirm) return;
          void runBulk(confirm.action, confirm.ids);
        }}
      />
    </div>
  );
}

function ResourceCell({ value, label }: { value: number | null | undefined; label: string }) {
  if (value == null) {
    return <span className="font-mono text-xs text-dockora-muted">—</span>;
  }
  return (
    <div className="min-w-[7.5rem] space-y-1.5">
      <p className="font-mono text-xs tabular-nums text-dockora-text">{label}</p>
      <ProgressBar value={value} className="h-1.5" />
    </div>
  );
}
