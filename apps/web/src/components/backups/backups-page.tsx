'use client';

import { useCallback, useEffect, useState } from 'react';
import type { BackupInfo } from '@dockora/shared';
import {
  cleanupBackups,
  createBackup,
  deleteBackup,
  fetchBackups,
  restoreBackup,
} from '@/lib/api';
import { useLocale } from '@/i18n/locale-provider';
import { useAuth } from '@/components/auth/auth-provider';
import { canAdmin } from '@/lib/roles';
import { formatBytes, formatRelativeTime } from '@/lib/format';
import { Button } from '@/components/ui/form-controls';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  DataTable,
  EmptyState,
  ErrorBanner,
  LoadingState,
  PageHeader,
  SuccessBanner,
} from '@/components/ui/page-parts';

export function BackupsPage() {
  const { t, locale } = useLocale();
  const { authEnabled, user } = useAuth();
  const isAdmin = canAdmin(user?.role, authEnabled);
  const loc = locale === 'de' ? 'de-DE' : 'en-US';
  const [items, setItems] = useState<BackupInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [includeVolumes, setIncludeVolumes] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setItems(await fetchBackups());
    } catch (err) {
      setError(err instanceof Error ? err.message : t.backups.loadError);
    } finally {
      setLoading(false);
    }
  }, [t.backups.loadError]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleCreate = async () => {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const backup = await createBackup({ includeVolumes });
      setSuccess(
        t.backups.createOk
          .replace('{name}', backup.name)
          .replace('{size}', formatBytes(backup.sizeBytes, loc)),
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t.common.failed);
    } finally {
      setBusy(false);
    }
  };

  const handleRestore = async (id: string, name: string) => {
    const typed = window.prompt(t.backups.restoreConfirmTyped.replace('{name}', name));
    if (typed !== name) {
      if (typed != null) setError(t.backups.restoreNameMismatch);
      return;
    }
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const result = await restoreBackup(id, {
        confirm: true,
        applyFiles: true,
        applySettings: true,
        applyVolumes: true,
      });
      setSuccess(result.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.common.failed);
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (id: string) => {
    setBusy(true);
    try {
      await deleteBackup(id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t.common.failed);
    } finally {
      setBusy(false);
    }
  };

  const handleCleanup = async () => {
    setBusy(true);
    try {
      await cleanupBackups();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t.common.failed);
    } finally {
      setBusy(false);
    }
  };

  const rows = items.map((b) => [
    b.name,
    b.format,
    formatBytes(b.sizeBytes, loc),
    formatRelativeTime(b.createdAt, loc),
    <span key={`inc-${b.id}`} className="text-xs text-dockora-muted">
      {b.includes.join(', ') || '—'}
    </span>,
    <div key={`act-${b.id}`} className="inline-flex flex-nowrap items-center gap-1.5">
      {isAdmin ? (
        <>
          <Button size="sm" disabled={busy} onClick={() => void handleRestore(b.id, b.name)}>
            {t.backups.restore}
          </Button>
          <Button
            size="sm"
            variant="danger"
            disabled={busy}
            onClick={() => setDeleteId(b.id)}
          >
            {t.common.delete}
          </Button>
        </>
      ) : (
        '—'
      )}
    </div>,
  ]);

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <PageHeader
        title={t.backups.title}
        subtitle={t.backups.subtitle}
        actions={
          <>
            {isAdmin ? (
              <>
                <label className="mr-2 flex items-center gap-2 text-sm text-dockora-muted">
                  <input
                    type="checkbox"
                    checked={includeVolumes}
                    onChange={(e) => setIncludeVolumes(e.target.checked)}
                  />
                  {t.backups.includeVolumes}
                </label>
                <Button variant="primary" disabled={busy} onClick={() => void handleCreate()}>
                  {t.backups.create}
                </Button>
                <Button disabled={busy} onClick={() => void handleCleanup()}>
                  {t.backups.cleanup}
                </Button>
              </>
            ) : null}
            <Button onClick={() => void load()}>{t.common.refresh}</Button>
          </>
        }
      />

      {error ? <ErrorBanner message={error} /> : null}
      {success ? <SuccessBanner message={success} /> : null}
      {loading ? <LoadingState message={t.common.loading} /> : null}

      {!loading ? (
        <DataTable
          stickyFirst
          stickyLast
          headers={[
            t.common.name,
            t.backups.format,
            t.common.size,
            t.common.created,
            t.backups.includes,
            t.common.actions,
          ]}
          rows={rows}
          empty={<EmptyState message={t.backups.empty} />}
        />
      ) : null}

      <ConfirmDialog
        open={Boolean(deleteId)}
        title={t.common.delete}
        description={t.backups.deleteConfirm}
        consequences={[...t.backups.deleteConsequences]}
        confirmLabel={t.common.confirm}
        cancelLabel={t.common.cancel}
        danger
        busy={busy}
        onCancel={() => setDeleteId(null)}
        onConfirm={() => {
          const id = deleteId;
          setDeleteId(null);
          if (id) void handleDelete(id);
        }}
      />
    </div>
  );
}
