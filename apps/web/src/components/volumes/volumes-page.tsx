'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { VolumeBrowseEntry, VolumeSummary } from '@dockora/shared';
import {
  browseVolume,
  fetchVolumes,
  pruneVolumes,
  removeVolume,
} from '@/lib/api';
import { useLocale } from '@/i18n/locale-provider';
import { useAuth } from '@/components/auth/auth-provider';
import { canAdmin } from '@/lib/roles';
import { formatBytes, formatRelativeTime } from '@/lib/format';
import { Button, FilterBar, Input } from '@/components/ui/form-controls';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  DataTable,
  EmptyState,
  ErrorBanner,
  LoadingState,
  PageHeader,
  StatusBadge,
  SuccessBanner,
} from '@/components/ui/page-parts';

type ConfirmState =
  | { kind: 'prune' }
  | { kind: 'remove'; name: string };

export function VolumesPage() {
  const { t, locale } = useLocale();
  const { authEnabled, user } = useAuth();
  const isAdmin = canAdmin(user?.role, authEnabled);
  const loc = locale === 'de' ? 'de-DE' : 'en-US';
  const [items, setItems] = useState<VolumeSummary[]>([]);
  const [query, setQuery] = useState('');
  const [unusedOnly, setUnusedOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [browseName, setBrowseName] = useState<string | null>(null);
  const [browseEntries, setBrowseEntries] = useState<VolumeBrowseEntry[] | null>(null);
  const [browseBusy, setBrowseBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setItems(await fetchVolumes());
    } catch (err) {
      setError(err instanceof Error ? err.message : t.volumes.loadError);
    } finally {
      setLoading(false);
    }
  }, [t.volumes.loadError]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((item) => {
      if (unusedOnly && !item.unused) return false;
      if (!q) return true;
      return (
        item.name.toLowerCase().includes(q) ||
        item.usedBy.some((name) => name.toLowerCase().includes(q))
      );
    });
  }, [items, query, unusedOnly]);

  const unusedCount = items.filter((i) => i.unused).length;
  const unusedBytes = items.filter((i) => i.unused).reduce((sum, i) => sum + (i.sizeBytes ?? 0), 0);

  const runPrune = async () => {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const result = await pruneVolumes();
      if (result.volumesDeleted <= 0 && result.spaceReclaimed <= 0) {
        setSuccess(t.volumes.pruneNone);
      } else {
        setSuccess(
          t.volumes.pruneResult
            .replace('{count}', String(result.volumesDeleted))
            .replace('{size}', formatBytes(result.spaceReclaimed, loc)),
        );
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t.common.failed);
    } finally {
      setBusy(false);
    }
  };

  const runRemove = async (name: string) => {
    setBusy(true);
    setError(null);
    try {
      await removeVolume(name);
      if (browseName === name) {
        setBrowseName(null);
        setBrowseEntries(null);
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t.common.failed);
    } finally {
      setBusy(false);
    }
  };

  const openBrowse = async (name: string) => {
    setBrowseName(name);
    setBrowseEntries(null);
    setBrowseBusy(true);
    setError(null);
    try {
      setBrowseEntries(await browseVolume(name));
    } catch (err) {
      setError(err instanceof Error ? err.message : t.volumes.browseError);
      setBrowseName(null);
    } finally {
      setBrowseBusy(false);
    }
  };

  const rows = filtered.map((vol) => [
    <span key={`n-${vol.name}`} className="font-mono text-xs">
      {vol.name}
    </span>,
    vol.unused ? (
      <StatusBadge key={`u-${vol.name}`} status="warning" label={t.volumes.unused} />
    ) : vol.protected ? (
      <StatusBadge key={`u-${vol.name}`} status="muted" label={t.volumes.protected} />
    ) : (
      <StatusBadge key={`u-${vol.name}`} status="success" label={t.volumes.inUse} />
    ),
    vol.sizeBytes == null ? '—' : formatBytes(vol.sizeBytes, loc),
    <span key={`by-${vol.name}`} className="text-xs text-dockora-muted">
      {vol.usedBy.join(', ') || '—'}
    </span>,
    vol.createdAt ? formatRelativeTime(vol.createdAt, loc) : '—',
    <div key={`a-${vol.name}`} className="flex flex-wrap gap-2">
      <Button size="sm" disabled={browseBusy} onClick={() => void openBrowse(vol.name)}>
        {t.volumes.browse}
      </Button>
      {isAdmin && vol.unused && !vol.protected ? (
        <Button
          size="sm"
          variant="danger"
          disabled={busy}
          onClick={() => setConfirm({ kind: 'remove', name: vol.name })}
        >
          {t.common.delete}
        </Button>
      ) : null}
    </div>,
  ]);

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <PageHeader
        title={t.volumes.title}
        subtitle={t.volumes.subtitle}
        actions={<Button onClick={() => void load()}>{t.common.refresh}</Button>}
      />

      <FilterBar>
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t.common.search}
          className="max-w-md"
        />
        <label className="flex items-center gap-2 text-sm text-dockora-muted">
          <input
            type="checkbox"
            className="h-4 w-4 accent-dockora-pink"
            checked={unusedOnly}
            onChange={(e) => setUnusedOnly(e.target.checked)}
          />
          {t.volumes.unusedOnly} ({unusedCount}
          {unusedBytes > 0 ? ` · ${formatBytes(unusedBytes, loc)}` : ''})
        </label>
        {isAdmin ? (
          <Button
            variant="danger"
            disabled={busy || unusedCount === 0}
            onClick={() => setConfirm({ kind: 'prune' })}
          >
            {t.volumes.prune}
          </Button>
        ) : null}
      </FilterBar>

      {error ? <ErrorBanner message={error} /> : null}
      {success ? <SuccessBanner message={success} /> : null}
      {loading ? <LoadingState message={t.common.loading} /> : null}
      {!loading ? (
        <DataTable
          stickyLast
          headers={[
            t.common.name,
            t.common.status,
            t.common.size,
            t.volumes.usedBy,
            t.common.created,
            t.common.actions,
          ]}
          rows={rows}
          empty={<EmptyState message={t.volumes.empty} />}
        />
      ) : null}

      {browseName ? (
        <section className="dockora-panel space-y-3 p-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-mono text-sm">
              {t.volumes.browseTitle}: {browseName}
            </h2>
            <Button
              size="sm"
              onClick={() => {
                setBrowseName(null);
                setBrowseEntries(null);
              }}
            >
              {t.common.cancel}
            </Button>
          </div>
          <p className="text-xs text-dockora-muted">{t.volumes.browseHint}</p>
          {browseBusy ? <LoadingState message={t.common.loading} /> : null}
          {!browseBusy && browseEntries && browseEntries.length === 0 ? (
            <EmptyState message={t.volumes.browseEmpty} />
          ) : null}
          {!browseBusy && browseEntries && browseEntries.length > 0 ? (
            <DataTable
              headers={[t.common.name, t.volumes.kind, t.common.size]}
              rows={browseEntries.map((entry) => [
                <span key={`bn-${entry.name}`} className="font-mono text-xs">
                  {entry.name}
                </span>,
                entry.kind === 'dir' ? t.volumes.dir : t.volumes.file,
                entry.sizeBytes == null ? '—' : formatBytes(entry.sizeBytes, loc),
              ])}
            />
          ) : null}
        </section>
      ) : null}

      <ConfirmDialog
        open={Boolean(confirm)}
        title={confirm?.kind === 'prune' ? t.volumes.prune : t.common.delete}
        description={
          confirm?.kind === 'prune' ? t.volumes.pruneConfirm : t.volumes.removeConfirm
        }
        consequences={
          confirm?.kind === 'prune'
            ? [...t.volumes.pruneConsequences]
            : [...t.volumes.removeConsequences]
        }
        confirmLabel={t.common.confirm}
        cancelLabel={t.common.cancel}
        danger
        busy={busy}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          const c = confirm;
          setConfirm(null);
          if (!c) return;
          if (c.kind === 'prune') void runPrune();
          else void runRemove(c.name);
        }}
      />
    </div>
  );
}
