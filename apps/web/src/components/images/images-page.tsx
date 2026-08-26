'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ImageSummary } from '@dockora/shared';
import { fetchImages, pruneImages, pullImage, removeImage } from '@/lib/api';
import { useLocale } from '@/i18n/locale-provider';
import { useAuth } from '@/components/auth/auth-provider';
import { canAdmin, canOperate } from '@/lib/roles';
import { formatBytes, formatRelativeTime } from '@/lib/format';
import { Button, Input, FilterBar } from '@/components/ui/form-controls';
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
  | { kind: 'pruneAll' }
  | { kind: 'remove'; id: string };

export function ImagesPage() {
  const { t, locale } = useLocale();
  const { authEnabled, user } = useAuth();
  const canOps = canOperate(user?.role, authEnabled);
  const isAdmin = canAdmin(user?.role, authEnabled);
  const loc = locale === 'de' ? 'de-DE' : 'en-US';
  const [items, setItems] = useState<ImageSummary[]>([]);
  const [pullRef, setPullRef] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setItems(await fetchImages());
    } catch (err) {
      setError(err instanceof Error ? err.message : t.images.loadError);
    } finally {
      setLoading(false);
    }
  }, [t.images.loadError]);

  useEffect(() => {
    void load();
  }, [load]);

  const handlePull = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pullRef.trim()) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      await pullImage(pullRef.trim());
      setPullRef('');
      setSuccess(t.common.success);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t.common.failed);
    } finally {
      setBusy(false);
    }
  };

  const runPrune = async (danglingOnly: boolean) => {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const result = await pruneImages(danglingOnly);
      if (result.imagesDeleted <= 0 && result.spaceReclaimed <= 0) {
        setSuccess(t.images.pruneNone);
      } else {
        setSuccess(
          t.images.pruneResult
            .replace('{count}', String(result.imagesDeleted))
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

  const handlePrune = (danglingOnly: boolean) => {
    if (!danglingOnly) {
      setConfirm({ kind: 'pruneAll' });
      return;
    }
    void runPrune(true);
  };

  const runRemove = async (id: string) => {
    setBusy(true);
    try {
      await removeImage(id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t.common.failed);
    } finally {
      setBusy(false);
    }
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((img) => {
      const tags = img.tags.join(' ').toLowerCase();
      return (
        img.id.toLowerCase().includes(q) ||
        tags.includes(q) ||
        img.usedBy.some((name) => name.toLowerCase().includes(q))
      );
    });
  }, [items, query]);

  const rows = filtered.map((img) => [
    <span key={`id-${img.id}`} className="font-mono text-xs">
      {img.id.slice(0, 12)}
    </span>,
    <span key={`tags-${img.id}`}>{img.tags.join(', ') || '<none>'}</span>,
    img.dangling ? (
      <StatusBadge key={`d-${img.id}`} status="warning" label={t.images.dangling} />
    ) : (
      <StatusBadge key={`d-${img.id}`} status="muted" label="—" />
    ),
    formatBytes(img.size, loc),
    formatRelativeTime(img.createdAt, loc),
    <span key={`u-${img.id}`} className="text-xs text-dockora-muted">
      {img.usedBy.join(', ') || '—'}
    </span>,
    isAdmin ? (
      <Button
        key={`a-${img.id}`}
        size="sm"
        variant="danger"
        disabled={busy}
        onClick={() => setConfirm({ kind: 'remove', id: img.id })}
      >
        {t.images.remove}
      </Button>
    ) : null,
  ]);

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <PageHeader
        title={t.images.title}
        subtitle={t.images.subtitle}
        actions={<Button onClick={() => void load()}>{t.common.refresh}</Button>}
      />

      <FilterBar>
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t.common.search}
          className="max-w-md"
        />
      </FilterBar>

      {canOps ? (
        <form onSubmit={(e) => void handlePull(e)}>
          <FilterBar>
            <Input
              value={pullRef}
              onChange={(e) => setPullRef(e.target.value)}
              placeholder={t.images.pullPlaceholder}
              className="max-w-md"
              disabled={busy}
            />
            <Button type="submit" variant="primary" disabled={busy || !pullRef.trim()}>
              {t.images.pull}
            </Button>
            {isAdmin ? (
              <>
                <Button type="button" disabled={busy} onClick={() => handlePrune(true)}>
                  {t.images.prune}
                </Button>
                <Button
                  type="button"
                  variant="danger"
                  disabled={busy}
                  onClick={() => handlePrune(false)}
                >
                  {t.images.pruneAll}
                </Button>
              </>
            ) : null}
          </FilterBar>
        </form>
      ) : null}

      {error ? <ErrorBanner message={error} /> : null}
      {success ? <SuccessBanner message={success} /> : null}
      {loading ? <LoadingState message={t.common.loading} /> : null}
      {!loading ? (
        <DataTable
          stickyLast
          headers={[
            'ID',
            t.images.tags,
            t.images.dangling,
            t.common.size,
            t.common.created,
            t.images.usedBy,
            t.common.actions,
          ]}
          rows={rows}
          empty={<EmptyState message={t.images.empty} />}
        />
      ) : null}

      <ConfirmDialog
        open={Boolean(confirm)}
        title={confirm?.kind === 'pruneAll' ? t.images.pruneAll : t.images.remove}
        description={
          confirm?.kind === 'pruneAll' ? t.images.pruneAllConfirm : t.images.removeConfirm
        }
        consequences={
          confirm?.kind === 'pruneAll'
            ? [...t.images.pruneAllConsequences]
            : [...t.images.removeConsequences]
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
          if (c.kind === 'pruneAll') void runPrune(false);
          else void runRemove(c.id);
        }}
      />
    </div>
  );
}
