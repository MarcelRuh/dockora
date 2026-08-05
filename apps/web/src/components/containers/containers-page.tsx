'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { ContainerFilter, ContainerSummary } from '@dockora/shared';
import { containerAction, fetchContainers } from '@/lib/api';
import { useLocale } from '@/i18n/locale-provider';
import { useAuth } from '@/components/auth/auth-provider';
import { canAdmin, canOperate } from '@/lib/roles';
import { containerStatusTone } from '@/lib/status';
import { formatRelativeTime } from '@/lib/format';
import { Button, Input, Select } from '@/components/ui/form-controls';
import {
  DataTable,
  EmptyState,
  ErrorBanner,
  LoadingState,
  PageHeader,
  StatusBadge,
} from '@/components/ui/page-parts';

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

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchContainers(filter);
      setItems(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.containers.loadError);
    } finally {
      setLoading(false);
    }
  }, [filter, t.containers.loadError]);

  useEffect(() => {
    void load();
  }, [load]);

  const runAction = async (id: string, action: 'start' | 'stop' | 'restart' | 'remove') => {
    if (action === 'remove' && !window.confirm(t.containers.removeConfirm)) return;
    setBusy(id);
    try {
      await containerAction(id, action, action === 'remove' ? { force: true } : undefined);
      await load();
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
    <span key={`ports-${c.id}`} className="font-mono text-xs text-dockora-muted">
      {c.ports.join(', ') || '—'}
    </span>,
    <time key={`cr-${c.id}`} className="text-xs text-dockora-muted">
      {formatRelativeTime(c.createdAt, loc)}
    </time>,
    <div key={`act-${c.id}`} className="flex flex-wrap gap-1">
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
          headers={[t.common.name, t.common.status, t.common.image, 'Ports', t.common.created, t.common.actions]}
          rows={rows}
          empty={<EmptyState message={t.containers.empty} />}
        />
      ) : null}

      {!loading && items.length > 0 ? (
        <p className="text-xs text-dockora-muted font-mono">{items.length} container(s)</p>
      ) : null}
    </div>
  );
}
