'use client';

import { useCallback, useEffect, useState } from 'react';
import { applySelfUpdate, fetchSelfUpdateStatus } from '@/lib/api';
import { useLocale } from '@/i18n/locale-provider';
import { Button } from '@/components/ui/form-controls';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ErrorBanner, Section, SuccessBanner } from '@/components/ui/page-parts';

type SelfStatus = Awaited<ReturnType<typeof fetchSelfUpdateStatus>>;

function shortRev(value: string | null | undefined): string {
  if (!value) return '—';
  return value.length > 12 ? `${value.slice(0, 12)}…` : value;
}

async function waitForApiHealth(timeoutMs = 180_000): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch('/api/v1/health', { cache: 'no-store' });
      if (res.ok) return true;
    } catch {
      // API down during rebuild
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
}

export function SelfUpdateSection() {
  const { t } = useLocale();
  const [status, setStatus] = useState<SelfStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      setStatus(await fetchSelfUpdateStatus());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.common.failed);
    }
  }, [t.common.failed]);

  useEffect(() => {
    void load();
  }, [load]);

  // Poll while an updater container is running (even after page reload).
  useEffect(() => {
    if (!status?.updating && !busy) return;
    const timer = window.setInterval(() => void load(), 3000);
    return () => window.clearInterval(timer);
  }, [status?.updating, busy, load]);

  const handleApply = async () => {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const result = await applySelfUpdate();
      setSuccess(result.message);
      await load();

      if (result.mode === 'compose' && result.ok) {
        setSuccess(`${result.message}\n${t.settings.selfUpdate.waitingHealth}`);
        // Wait until updater finishes, then until API is healthy again.
        const deadline = Date.now() + 20 * 60 * 1000;
        while (Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 3000));
          const next = await fetchSelfUpdateStatus();
          setStatus(next);
          if (!next.updating) break;
        }
        const ok = await waitForApiHealth(180_000);
        if (ok) {
          setSuccess(t.settings.selfUpdate.healthOk);
          await load();
          window.setTimeout(() => window.location.reload(), 1500);
        } else {
          setSuccess(t.settings.selfUpdate.healthTimeout);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t.common.failed);
      await load();
    } finally {
      setBusy(false);
    }
  };

  const modeLabel =
    status?.mode === 'compose'
      ? t.settings.selfUpdate.modeCompose
      : status?.mode === 'image'
        ? t.settings.selfUpdate.modeImage
        : t.settings.selfUpdate.modeNone;

  return (
    <Section title={t.settings.selfUpdate.title}>
      <p className="mb-3 text-sm text-dockora-muted">{t.settings.selfUpdate.hint}</p>
      {error ? <ErrorBanner message={error} /> : null}
      {success ? <SuccessBanner message={success} /> : null}
      {status ? (
        <div className="dockora-panel space-y-2 px-4 py-3 text-sm">
          <p>
            <span className="text-dockora-muted">{t.settings.selfUpdate.mode}: </span>
            <span className="font-medium">{modeLabel}</span>
          </p>
          <p>
            <span className="text-dockora-muted">{t.settings.selfUpdate.version}: </span>
            <span className="font-mono">{status.currentVersion}</span>
          </p>
          {status.mode === 'compose' ? (
            <>
              <p>
                <span className="text-dockora-muted">{t.settings.selfUpdate.installDir}: </span>
                <span className="font-mono text-xs">{status.installDir ?? '—'}</span>
              </p>
              <p>
                <span className="text-dockora-muted">{t.settings.selfUpdate.repo}: </span>
                <span className="font-mono text-xs">
                  {status.repo ?? '—'}@{status.branch ?? 'main'}
                </span>
              </p>
              <p>
                <span className="text-dockora-muted">{t.settings.selfUpdate.localRev}: </span>
                <span className="font-mono text-xs">{shortRev(status.localRevision)}</span>
              </p>
              <p>
                <span className="text-dockora-muted">{t.settings.selfUpdate.remoteRev}: </span>
                <span className="font-mono text-xs">{shortRev(status.remoteRevision)}</span>
              </p>
            </>
          ) : (
            <p>
              <span className="text-dockora-muted">{t.settings.selfUpdate.image}: </span>
              <span className="font-mono text-xs">{status.image ?? '—'}</span>
            </p>
          )}
          <p className="text-dockora-muted whitespace-pre-wrap">{status.message}</p>
          <div className="flex flex-wrap gap-2 pt-2">
            <Button disabled={busy} onClick={() => void load()}>
              {t.common.refresh}
            </Button>
            <Button
              variant="primary"
              disabled={busy || !status.enabled || (!status.updateAvailable && !status.updating)}
              onClick={() => setConfirmOpen(true)}
            >
              {busy || status.updating
                ? t.settings.selfUpdate.applying
                : t.settings.selfUpdate.apply}
            </Button>
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        open={confirmOpen}
        title={t.settings.selfUpdate.apply}
        description={t.settings.selfUpdate.confirm}
        consequences={[...t.settings.selfUpdate.consequences]}
        confirmLabel={t.common.confirm}
        cancelLabel={t.common.cancel}
        danger
        busy={busy}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => {
          setConfirmOpen(false);
          void handleApply();
        }}
      />
    </Section>
  );
}
