'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ImageSummary } from '@dockora/shared';
import { fetchImages, pruneImages, pullImage, removeImage } from '@/lib/api';
import { useLocale } from '@/i18n/locale-provider';
import { useAuth } from '@/components/auth/auth-provider';
import { canAdmin, canOperate } from '@/lib/roles';
import { formatBytes, formatRelativeTime } from '@/lib/format';
import { Button, Input } from '@/components/ui/form-controls';
import {
  DataTable,
  EmptyState,
  ErrorBanner,
  LoadingState,
  PageHeader,
  StatusBadge,
} from '@/components/ui/page-parts';

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
  const [busy, setBusy] = useState(false);

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
    try {
      await pullImage(pullRef.trim());
      setPullRef('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t.common.failed);
    } finally {
      setBusy(false);
    }
  };

  const handlePrune = async (danglingOnly: boolean) => {
    setBusy(true);
    try {
      await pruneImages(danglingOnly);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t.common.failed);
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async (id: string) => {
    if (!window.confirm(t.images.removeConfirm)) return;
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

  const rows = items.map((img) => [
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
      <Button key={`r-${img.id}`} variant="danger" disabled={busy} onClick={() => void handleRemove(img.id)}>
        {t.images.remove}
      </Button>
    ) : (
      '—'
    ),
  ]);

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <PageHeader title={t.images.title} subtitle={t.images.subtitle} />

      <form onSubmit={(e) => void handlePull(e)} className="flex flex-wrap gap-2">
        {canOps ? (
          <>
            <Input
              placeholder={t.images.pullPlaceholder}
              value={pullRef}
              onChange={(e) => setPullRef(e.target.value)}
              className="max-w-md"
            />
            <Button type="submit" variant="primary" disabled={busy}>
              {t.images.pull}
            </Button>
          </>
        ) : null}
        {isAdmin ? (
          <>
            <Button type="button" disabled={busy} onClick={() => void handlePrune(true)}>
              {t.images.prune}
            </Button>
            <Button type="button" disabled={busy} onClick={() => void handlePrune(false)}>
              {t.images.pruneAll}
            </Button>
          </>
        ) : null}
        <Button type="button" onClick={() => void load()}>
          {t.common.refresh}
        </Button>
      </form>

      {error ? <ErrorBanner message={error} /> : null}
      {loading ? <LoadingState message={t.common.loading} /> : null}

      {!loading ? (
        <DataTable
          headers={[t.common.name, t.images.tags, t.images.dangling, t.common.size, t.common.created, t.images.usedBy, t.common.actions]}
          rows={rows}
          empty={<EmptyState message={t.images.empty} />}
        />
      ) : null}
    </div>
  );
}
