'use client';

import { useCallback, useEffect, useState } from 'react';
import type { UpdateCheckResult } from '@dockora/shared';
import { checkUpdates, fetchUpdates, pullUpdate } from '@/lib/api';
import { useLocale } from '@/i18n/locale-provider';
import { useAuth } from '@/components/auth/auth-provider';
import { canOperate } from '@/lib/roles';
import { formatRelativeTime } from '@/lib/format';
import { Button } from '@/components/ui/form-controls';
import {
  DataTable,
  EmptyState,
  ErrorBanner,
  LoadingState,
  PageHeader,
  StatusBadge,
  SuccessBanner,
} from '@/components/ui/page-parts';

export function UpdatesPage() {
  const { t, locale } = useLocale();
  const { authEnabled, user } = useAuth();
  const canOps = canOperate(user?.role, authEnabled);
  const loc = locale === 'de' ? 'de-DE' : 'en-US';
  const [items, setItems] = useState<UpdateCheckResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [phase, setPhase] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setItems(await fetchUpdates());
    } catch (err) {
      setError(err instanceof Error ? err.message : t.updates.loadError);
    } finally {
      setLoading(false);
    }
  }, [t.updates.loadError]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleCheck = async () => {
    setChecking(true);
    setError(null);
    setSuccess(null);
    setPhase(t.updates.phaseChecking);
    try {
      setItems(await checkUpdates());
      setSuccess(t.updates.checkDone);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.common.failed);
    } finally {
      setChecking(false);
      setPhase(null);
    }
  };

  const handlePull = async (containerId: string) => {
    if (!window.confirm(t.updates.applyConfirm)) return;
    setBusy(containerId);
    setError(null);
    setSuccess(null);
    setPhase(t.updates.phaseApplying);
    try {
      const result = await pullUpdate(containerId);
      if (!result.ok) {
        setError(result.message);
      } else {
        setSuccess(result.message);
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t.common.failed);
    } finally {
      setBusy(null);
      setPhase(null);
    }
  };

  const rows = items.map((u) => [
    u.containerName,
    <span key={`img-${u.containerId}`} className="font-mono text-xs">
      {u.image}
    </span>,
    u.currentTag,
    u.registry,
    u.error ? (
      <StatusBadge key={`st-${u.containerId}`} status="danger" label={t.updates.checkFailed} />
    ) : u.updateAvailable ? (
      <StatusBadge key={`st-${u.containerId}`} status="warning" label={t.updates.available} />
    ) : (
      <StatusBadge key={`st-${u.containerId}`} status="success" label={t.updates.upToDate} />
    ),
    formatRelativeTime(u.checkedAt, loc),
    u.error ? (
      <span key={`err-${u.containerId}`} className="text-xs text-dockora-danger">
        {u.error}
      </span>
    ) : u.updateAvailable && canOps ? (
      <Button
        key={`pull-${u.containerId}`}
        variant="primary"
        disabled={busy === u.containerId}
        onClick={() => void handlePull(u.containerId)}
      >
        {busy === u.containerId ? t.updates.applying : t.updates.pull}
      </Button>
    ) : (
      '—'
    ),
  ]);

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <PageHeader
        title={t.updates.title}
        subtitle={t.updates.subtitle}
        actions={
          <>
            <Button variant="primary" disabled={checking} onClick={() => void handleCheck()}>
              {checking ? t.updates.checking : t.updates.check}
            </Button>
            <Button onClick={() => void load()}>{t.common.refresh}</Button>
          </>
        }
      />

      {phase ? (
        <p className="font-mono text-xs uppercase tracking-wider text-dockora-accent">{phase}</p>
      ) : null}
      {error ? <ErrorBanner message={error} /> : null}
      {success ? <SuccessBanner message={success} /> : null}
      {loading ? <LoadingState message={t.common.loading} /> : null}

      {!loading ? (
        <DataTable
          headers={[
            t.common.name,
            t.common.image,
            t.updates.currentTag,
            t.updates.registry,
            t.common.status,
            t.updates.checkedAt,
            t.common.actions,
          ]}
          rows={rows}
          empty={<EmptyState message={t.updates.empty} />}
        />
      ) : null}
    </div>
  );
}
