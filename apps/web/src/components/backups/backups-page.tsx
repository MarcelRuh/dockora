'use client';

import { useCallback, useEffect, useState } from 'react';
import type { BackupInfo, BackupRestorePreview } from '@dockora/shared';
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

type RestoreDraft = {
  id: string;
  name: string;
  preview: BackupRestorePreview;
  applyFiles: boolean;
  applySettings: boolean;
  applyVolumes: boolean;
};

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
  const [restoreDraft, setRestoreDraft] = useState<RestoreDraft | null>(null);

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

  const startRestore = async (id: string, name: string) => {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const previewResult = await restoreBackup(id, { confirm: false });
      const preview = previewResult.preview ?? {
        composeFiles: [],
        envFiles: [],
        hasSettings: false,
        volumes: [],
      };
      setRestoreDraft({
        id,
        name,
        preview,
        applyFiles: preview.composeFiles.length + preview.envFiles.length > 0,
        applySettings: preview.hasSettings,
        applyVolumes: preview.volumes.length > 0,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : t.common.failed);
    } finally {
      setBusy(false);
    }
  };

  const confirmRestore = async () => {
    if (!restoreDraft) return;
    const typed = window.prompt(
      t.backups.restoreConfirmTyped.replace('{name}', restoreDraft.name),
    );
    if (typed !== restoreDraft.name) {
      if (typed != null) setError(t.backups.restoreNameMismatch);
      return;
    }
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const result = await restoreBackup(restoreDraft.id, {
        confirm: true,
        applyFiles: restoreDraft.applyFiles,
        applySettings: restoreDraft.applySettings,
        applyVolumes: restoreDraft.applyVolumes,
      });
      setSuccess(result.message);
      setRestoreDraft(null);
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
          <Button size="sm" disabled={busy} onClick={() => void startRestore(b.id, b.name)}>
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

      <ConfirmDialog
        open={Boolean(restoreDraft)}
        title={t.backups.restorePreviewTitle}
        description={
          restoreDraft
            ? t.backups.restorePreviewHint.replace('{name}', restoreDraft.name)
            : undefined
        }
        consequences={
          restoreDraft
            ? [
                t.backups.restorePreviewCompose.replace(
                  '{count}',
                  String(restoreDraft.preview.composeFiles.length),
                ),
                t.backups.restorePreviewEnv.replace(
                  '{count}',
                  String(restoreDraft.preview.envFiles.length),
                ),
                restoreDraft.preview.hasSettings
                  ? t.backups.restorePreviewSettingsYes
                  : t.backups.restorePreviewSettingsNo,
                t.backups.restorePreviewVolumes.replace(
                  '{count}',
                  String(restoreDraft.preview.volumes.length),
                ),
              ]
            : []
        }
        confirmLabel={t.backups.restoreApply}
        cancelLabel={t.common.cancel}
        danger
        busy={busy}
        onCancel={() => setRestoreDraft(null)}
        onConfirm={() => void confirmRestore()}
      >
        {restoreDraft ? (
          <div className="mt-3 space-y-2 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={restoreDraft.applyFiles}
                onChange={(e) =>
                  setRestoreDraft({ ...restoreDraft, applyFiles: e.target.checked })
                }
              />
              {t.backups.applyFiles}
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={restoreDraft.applySettings}
                disabled={!restoreDraft.preview.hasSettings}
                onChange={(e) =>
                  setRestoreDraft({ ...restoreDraft, applySettings: e.target.checked })
                }
              />
              {t.backups.applySettings}
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={restoreDraft.applyVolumes}
                disabled={restoreDraft.preview.volumes.length === 0}
                onChange={(e) =>
                  setRestoreDraft({ ...restoreDraft, applyVolumes: e.target.checked })
                }
              />
              {t.backups.applyVolumes}
            </label>
          </div>
        ) : null}
      </ConfirmDialog>
    </div>
  );
}
