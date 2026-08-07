'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { UpdateCheckResult } from '@dockora/shared';
import { checkUpdates, fetchUpdates, pullUpdate } from '@/lib/api';
import { useLocale } from '@/i18n/locale-provider';
import { useAuth } from '@/components/auth/auth-provider';
import { canOperate } from '@/lib/roles';
import { formatRelativeTime } from '@/lib/format';
import { Button } from '@/components/ui/form-controls';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ProgressBar } from '@/components/ui/progress-bar';
import {
  DataTable,
  EmptyState,
  ErrorBanner,
  LoadingState,
  PageHeader,
  StatusBadge,
  SuccessBanner,
  TabBar,
} from '@/components/ui/page-parts';

type FilterId = 'all' | 'available' | 'errors';
type ApplyStep = 'pull' | 'recreate' | 'health' | 'done' | 'rollback';

function shortDigest(d: string | null | undefined): string {
  if (!d) return '—';
  const bare = d.replace(/^sha256:/, '');
  return `sha256:${bare.slice(0, 12)}…`;
}

function errorStatusLabel(
  error: string | undefined,
  labels: {
    statusAuth: string;
    statusManifest: string;
    statusRateLimit: string;
    checkFailed: string;
  },
): string {
  if (!error) return labels.checkFailed;
  const lower = error.toLowerCase();
  if (
    lower.includes('auth required') ||
    lower.includes('invalid token') ||
    lower.includes('denied') ||
    lower.includes('(401)') ||
    lower.includes('(403)')
  ) {
    return labels.statusAuth;
  }
  if (lower.includes('rate limited') || lower.includes('(429)')) {
    return labels.statusRateLimit;
  }
  if (lower.includes('manifest not found') || lower.includes('(404)')) {
    return labels.statusManifest;
  }
  if (lower.includes('manifest fetch failed')) {
    return labels.statusManifest;
  }
  return labels.checkFailed;
}

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
  const [filter, setFilter] = useState<FilterId>('all');
  const [confirm, setConfirm] = useState<null | { mode: 'one' | 'all'; id?: string; count?: number }>(
    null,
  );
  const [applyStep, setApplyStep] = useState<ApplyStep | null>(null);
  const [applyProgress, setApplyProgress] = useState(0);

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

  const filtered = useMemo(() => {
    if (filter === 'available') return items.filter((u) => u.updateAvailable && !u.error);
    if (filter === 'errors') return items.filter((u) => Boolean(u.error));
    return items;
  }, [items, filter]);

  const availableCount = items.filter((u) => u.updateAvailable && !u.error).length;

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

  const runApplySteps = async (ids: string[]) => {
    setError(null);
    setSuccess(null);
    const steps: ApplyStep[] = ['pull', 'recreate', 'health'];
    let stepIdx = 0;
    const timer = window.setInterval(() => {
      stepIdx = Math.min(stepIdx + 1, steps.length - 1);
      setApplyStep(steps[stepIdx]!);
      setApplyProgress(((stepIdx + 1) / (steps.length + 1)) * 100);
    }, 2500);

    try {
      for (let i = 0; i < ids.length; i++) {
        const id = ids[i]!;
        setBusy(id);
        setPhase(
          t.common.bulkProgress.replace('{done}', String(i + 1)).replace('{total}', String(ids.length)),
        );
        setApplyStep('pull');
        setApplyProgress(15);
        const result = await pullUpdate(id);
        if (!result.ok) {
          const msg = result.message;
          const isHealth =
            /health/i.test(msg) || /rollback/i.test(msg);
          setApplyStep(isHealth ? 'rollback' : 'done');
          setApplyProgress(100);
          setError(
            isHealth ? `${t.updates.healthFailedRollback}: ${msg}` : msg,
          );
          await load();
          return;
        }
      }
      setApplyStep('done');
      setApplyProgress(100);
      setSuccess(t.common.success);
      await load();
    } catch (err) {
      setApplyStep('rollback');
      setError(err instanceof Error ? err.message : t.common.failed);
    } finally {
      window.clearInterval(timer);
      setBusy(null);
      setPhase(null);
      setConfirm(null);
      window.setTimeout(() => {
        setApplyStep(null);
        setApplyProgress(0);
      }, 1500);
    }
  };

  const rows = filtered.map((u) => [
    <span key={`n-${u.containerId}`} className="font-medium">
      {u.containerName}
    </span>,
    <span key={`img-${u.containerId}`} className="font-mono text-xs text-dockora-muted">
      {u.image}
    </span>,
    u.currentTag,
    u.registry,
    u.error ? (
      <div key={`st-${u.containerId}`} className="max-w-md space-y-1.5">
        <StatusBadge status="danger" label={errorStatusLabel(u.error, t.updates)} />
        <p className="break-words font-mono text-[11px] leading-snug text-dockora-danger" title={u.error}>
          {u.error}
        </p>
      </div>
    ) : u.updateAvailable ? (
      <StatusBadge key={`st-${u.containerId}`} status="warning" label={t.updates.available} />
    ) : (
      <StatusBadge key={`st-${u.containerId}`} status="success" label={t.updates.upToDate} />
    ),
    <span key={`dg-${u.containerId}`} className="font-mono text-[11px] text-dockora-muted" title={`${u.currentDigest ?? ''} → ${u.remoteDigest ?? ''}`}>
      {shortDigest(u.currentDigest)}
      {u.updateAvailable ? (
        <>
          <br />
          <span className="text-dockora-pink">→ {shortDigest(u.remoteDigest)}</span>
        </>
      ) : null}
    </span>,
    formatRelativeTime(u.checkedAt, loc),
    u.error ? (
      '—'
    ) : u.updateAvailable && canOps ? (
      <Button
        key={`pull-${u.containerId}`}
        size="sm"
        variant="primary"
        disabled={busy === u.containerId || Boolean(busy)}
        onClick={() => setConfirm({ mode: 'one', id: u.containerId })}
      >
        {busy === u.containerId ? t.updates.applying : t.updates.pull}
      </Button>
    ) : (
      '—'
    ),
  ]);

  const stepLabel =
    applyStep === 'pull'
      ? t.updates.stepPull
      : applyStep === 'recreate'
        ? t.updates.stepRecreate
        : applyStep === 'health'
          ? t.updates.stepHealth
          : applyStep === 'rollback'
            ? t.updates.stepRollback
            : applyStep === 'done'
              ? t.updates.stepDone
              : null;

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
            {canOps && availableCount > 0 ? (
              <Button
                disabled={Boolean(busy)}
                onClick={() => setConfirm({ mode: 'all', count: availableCount })}
              >
                {t.updates.applyAll}
              </Button>
            ) : null}
            <Button onClick={() => void load()}>{t.common.refresh}</Button>
          </>
        }
      />

      <TabBar
        tabs={[
          { id: 'all', label: `${t.updates.filterAll} (${items.length})` },
          { id: 'available', label: `${t.updates.filterAvailable} (${availableCount})` },
          {
            id: 'errors',
            label: `${t.updates.filterErrors} (${items.filter((u) => u.error).length})`,
          },
        ]}
        active={filter}
        onChange={(id) => setFilter(id as FilterId)}
      />

      {applyStep ? (
        <div className="dockora-panel space-y-2 p-4">
          <p className="font-display text-[11px] uppercase tracking-wider text-dockora-blue">
            {stepLabel}
            {phase ? ` · ${phase}` : null}
          </p>
          <ProgressBar value={applyProgress} autoTone={false} />
        </div>
      ) : null}

      {phase && !applyStep ? (
        <p className="font-mono text-xs uppercase tracking-wider text-dockora-accent">{phase}</p>
      ) : null}
      {error ? <ErrorBanner message={error} /> : null}
      {success ? <SuccessBanner message={success} /> : null}
      {loading ? <LoadingState message={t.common.loading} /> : null}

      {!loading ? (
        <DataTable
          stickyFirst
          stickyLast
          headers={[
            t.common.name,
            t.common.image,
            t.updates.currentTag,
            t.updates.registry,
            t.common.status,
            t.updates.digest,
            t.updates.checkedAt,
            t.common.actions,
          ]}
          rows={rows}
          empty={<EmptyState message={t.updates.empty} />}
        />
      ) : null}

      <ConfirmDialog
        open={Boolean(confirm)}
        title={confirm?.mode === 'all' ? t.updates.applyAll : t.updates.pull}
        description={
          confirm?.mode === 'all'
            ? t.updates.applyAllConfirm.replace('{count}', String(confirm.count ?? 0))
            : t.updates.applyConfirm
        }
        consequences={[
          t.updates.stepPull,
          t.updates.stepRecreate,
          t.updates.stepHealth,
          `${t.updates.stepRollback} ${locale === 'de' ? 'bei Health-Fail' : 'on health fail'}`,
        ]}
        confirmLabel={t.common.confirm}
        cancelLabel={t.common.cancel}
        danger={false}
        busy={Boolean(busy)}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          if (!confirm) return;
          if (confirm.mode === 'one' && confirm.id) {
            void runApplySteps([confirm.id]);
          } else {
            void runApplySteps(
              items.filter((u) => u.updateAvailable && !u.error).map((u) => u.containerId),
            );
          }
        }}
      />
    </div>
  );
}
