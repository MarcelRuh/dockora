'use client';

import { useCallback, useEffect, useState } from 'react';
import { applySelfUpdate, fetchSelfUpdateStatus } from '@/lib/api';
import { useLocale } from '@/i18n/locale-provider';
import { Button } from '@/components/ui/form-controls';
import { ErrorBanner, Section, SuccessBanner } from '@/components/ui/page-parts';

type SelfStatus = Awaited<ReturnType<typeof fetchSelfUpdateStatus>>;

function shortRev(value: string | null | undefined): string {
  if (!value) return '—';
  return value.length > 12 ? `${value.slice(0, 12)}…` : value;
}

export function SelfUpdateSection() {
  const { t } = useLocale();
  const [status, setStatus] = useState<SelfStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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

  const handleApply = async () => {
    if (!window.confirm(t.settings.selfUpdate.confirm)) return;
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const result = await applySelfUpdate();
      setSuccess(result.message);
      await load();
      if (result.mode === 'compose') {
        // Stack rebuild restarts API/Web – poll briefly then reload page
        window.setTimeout(() => {
          window.location.reload();
        }, 90_000);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t.common.failed);
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
          <p className="text-dockora-muted">{status.message}</p>
          <div className="flex flex-wrap gap-2 pt-2">
            <Button disabled={busy} onClick={() => void load()}>
              {t.common.refresh}
            </Button>
            <Button
              variant="primary"
              disabled={busy || !status.enabled || (!status.updateAvailable && !status.updating)}
              onClick={() => void handleApply()}
            >
              {busy || status.updating
                ? t.settings.selfUpdate.applying
                : t.settings.selfUpdate.apply}
            </Button>
          </div>
        </div>
      ) : null}
    </Section>
  );
}
