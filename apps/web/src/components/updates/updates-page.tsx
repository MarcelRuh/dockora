'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { UpdateCheckResult } from '@dockora/shared';
import { checkUpdates, fetchUpdates, pullUpdate } from '@/lib/api';
import { useLocale } from '@/i18n/locale-provider';
import { useAuth } from '@/components/auth/auth-provider';
import { canOperate } from '@/lib/roles';
import { formatRelativeTime } from '@/lib/format';
import { Button } from '@/components/ui/form-controls';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ProgressBar } from '@/components/ui/progress-bar';
import { cn } from '@/lib/utils';
import {
  EmptyState,
  ErrorBanner,
  LoadingState,
  PageHeader,
  StatusBadge,
  SuccessBanner,
  TabBar,
  tabPanelProps,
} from '@/components/ui/page-parts';

type FilterId = 'all' | 'available' | 'errors';
type ApplyStep = 'pull' | 'recreate' | 'health' | 'done' | 'rollback';

const REGISTRY_LABELS: Record<string, string> = {
  dockerhub: 'Docker Hub',
  ghcr: 'GHCR',
  quay: 'Quay',
  gitlab: 'GitLab',
  gitea: 'Gitea',
  private: 'Registry',
};

function shortDigest(d: string | null | undefined): string {
  if (!d) return '—';
  return `${d.replace(/^sha256:/, '').slice(0, 12)}`;
}

function isImageId(ref: string): boolean {
  return /^(sha256:)?[0-9a-f]{12,64}$/i.test(ref.trim());
}

/** `ghcr.io/foo/bar:latest` → { repo: 'ghcr.io/foo/bar', tag: 'latest' } */
function splitImage(image: string): { repo: string; tag: string | null } {
  if (isImageId(image)) return { repo: image, tag: null };
  const [withoutDigest, digest] = image.split('@');
  const ref = withoutDigest ?? image;
  const lastSlash = ref.lastIndexOf('/');
  const lastColon = ref.lastIndexOf(':');
  if (lastColon > lastSlash) {
    return { repo: ref.slice(0, lastColon), tag: ref.slice(lastColon + 1) };
  }
  return { repo: ref, tag: digest ? `@${shortDigest(digest)}` : 'latest' };
}

type ErrorKind = 'auth' | 'rateLimit' | 'manifest' | 'imageId' | 'generic';

function classifyError(error: string | undefined): ErrorKind {
  if (!error) return 'generic';
  const lower = error.toLowerCase();
  if (lower.includes('references an image id')) return 'imageId';
  if (
    lower.includes('auth required') ||
    lower.includes('invalid token') ||
    lower.includes('denied') ||
    lower.includes('(401)') ||
    lower.includes('(403)')
  ) {
    return 'auth';
  }
  if (lower.includes('rate limited') || lower.includes('(429)')) return 'rateLimit';
  if (
    lower.includes('manifest not found') ||
    lower.includes('(404)') ||
    lower.includes('manifest fetch failed')
  ) {
    return 'manifest';
  }
  return 'generic';
}

type RowState = 'available' | 'error' | 'current';

function rowState(u: UpdateCheckResult): RowState {
  if (u.error) return 'error';
  return u.updateAvailable ? 'available' : 'current';
}

const STATE_ORDER: Record<RowState, number> = { available: 0, error: 1, current: 2 };

const STATE_DOT: Record<RowState, string> = {
  available: 'bg-dockora-warning shadow-[0_0_10px_rgba(255,190,11,0.7)]',
  error: 'bg-dockora-danger shadow-[0_0_10px_rgba(255,84,0,0.7)]',
  current: 'bg-dockora-success shadow-[0_0_8px_rgba(6,214,160,0.55)]',
};

function SummaryTile({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: React.ReactNode;
  tone?: 'default' | 'warning' | 'danger';
}) {
  return (
    <div className="dockora-panel flex flex-col gap-1 px-4 py-3">
      <span className="font-display text-[10px] font-semibold uppercase tracking-[0.14em] text-dockora-muted">
        {label}
      </span>
      <span
        className={cn(
          'text-2xl font-semibold tabular-nums leading-tight',
          tone === 'warning' && 'text-dockora-warning',
          tone === 'danger' && 'text-dockora-danger',
          tone === 'default' && 'text-white',
        )}
      >
        {value}
      </span>
    </div>
  );
}

function Chip({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className="inline-flex h-5 max-w-full items-center truncate border border-dockora-border bg-white/[0.03] px-1.5 font-mono text-[10px] text-dockora-muted"
    >
      {children}
    </span>
  );
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
  const tabsId = useId();
  const [confirm, setConfirm] = useState<null | { mode: 'one' | 'all'; id?: string; count?: number }>(
    null,
  );
  const [applyStep, setApplyStep] = useState<ApplyStep | null>(null);
  const [applyProgress, setApplyProgress] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
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
    const list =
      filter === 'available'
        ? items.filter((u) => u.updateAvailable && !u.error)
        : filter === 'errors'
          ? items.filter((u) => Boolean(u.error))
          : items;
    return [...list].sort(
      (a, b) =>
        STATE_ORDER[rowState(a)] - STATE_ORDER[rowState(b)] ||
        a.containerName.localeCompare(b.containerName),
    );
  }, [items, filter]);

  const availableCount = useMemo(
    () => items.filter((u) => u.updateAvailable && !u.error).length,
    [items],
  );
  const errorCount = useMemo(() => items.filter((u) => u.error).length, [items]);
  const lastCheckedAt = useMemo(
    () =>
      items.reduce<string | null>(
        (latest, u) => (!latest || u.checkedAt > latest ? u.checkedAt : latest),
        null,
      ),
    [items],
  );

  const errorText = (kind: ErrorKind) =>
    ({
      auth: { label: t.updates.statusAuth, hint: t.updates.hintAuth },
      rateLimit: { label: t.updates.statusRateLimit, hint: t.updates.hintRateLimit },
      manifest: { label: t.updates.statusManifest, hint: t.updates.hintManifest },
      imageId: { label: t.updates.statusImageId, hint: t.updates.hintImageId },
      generic: { label: t.updates.checkFailed, hint: t.updates.hintGeneric },
    })[kind];

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

  const resetTimerRef = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (resetTimerRef.current) window.clearTimeout(resetTimerRef.current);
    },
    [],
  );

  const runApplySteps = async (ids: string[]) => {
    if (resetTimerRef.current) window.clearTimeout(resetTimerRef.current);
    resetTimerRef.current = null;
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
      const failed: { name: string; message: string; rolledBack: boolean }[] = [];
      for (let i = 0; i < ids.length; i++) {
        const id = ids[i]!;
        const name = items.find((u) => u.containerId === id)?.containerName ?? id.slice(0, 12);
        setBusy(id);
        setPhase(
          ids.length > 1
            ? `${name} · ${t.common.bulkProgress.replace('{done}', String(i + 1)).replace('{total}', String(ids.length))}`
            : name,
        );
        stepIdx = 0;
        setApplyStep('pull');
        setApplyProgress(15);
        const result = await pullUpdate(id);
        if (!result.ok) {
          const rolledBack = result.rolledBack === true || result.step === 'rollback';
          failed.push({
            name,
            rolledBack,
            message: rolledBack ? `${t.updates.healthFailedRollback}: ${result.message}` : result.message,
          });
          if (rolledBack) setApplyStep('rollback');
        }
      }
      setApplyStep(failed.some((f) => f.rolledBack) ? 'rollback' : 'done');
      setApplyProgress(100);
      if (failed.length === 0) {
        setSuccess(t.common.success);
      } else if (ids.length === 1) {
        setError(failed[0]!.message);
      } else {
        setError(
          t.updates.bulkPartial
            .replace('{ok}', String(ids.length - failed.length))
            .replace('{total}', String(ids.length))
            .replace('{failed}', failed.map((f) => `${f.name} (${f.message})`).join('; ')),
        );
      }
      await load();
    } catch (err) {
      setApplyStep('rollback');
      setError(err instanceof Error ? err.message : t.common.failed);
    } finally {
      window.clearInterval(timer);
      setBusy(null);
      setPhase(null);
      resetTimerRef.current = window.setTimeout(() => {
        resetTimerRef.current = null;
        setApplyStep(null);
        setApplyProgress(0);
      }, 1500);
    }
  };

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
            {canOps ? (
              <Button variant="primary" disabled={checking} onClick={() => void handleCheck()}>
                {checking ? t.updates.checking : t.updates.check}
              </Button>
            ) : null}
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

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryTile label={t.updates.summaryTotal} value={items.length} />
        <SummaryTile
          label={t.updates.summaryAvailable}
          value={availableCount}
          tone={availableCount > 0 ? 'warning' : 'default'}
        />
        <SummaryTile
          label={t.updates.summaryErrors}
          value={errorCount}
          tone={errorCount > 0 ? 'danger' : 'default'}
        />
        <SummaryTile
          label={t.updates.summaryLastCheck}
          value={
            <span className="text-base font-medium">
              {lastCheckedAt ? formatRelativeTime(lastCheckedAt, loc) : t.updates.never}
            </span>
          }
        />
      </div>

      <TabBar
        idPrefix={tabsId}
        tabs={[
          { id: 'all', label: `${t.updates.filterAll} (${items.length})` },
          { id: 'available', label: `${t.updates.filterAvailable} (${availableCount})` },
          { id: 'errors', label: `${t.updates.filterErrors} (${errorCount})` },
        ]}
        active={filter}
        onChange={(id) => setFilter(id as FilterId)}
      />

      {applyStep ? (
        <div className="dockora-panel space-y-2 p-4" aria-live="polite">
          <p className="font-display text-[11px] uppercase tracking-wider text-dockora-blue">
            {stepLabel}
            {phase ? ` · ${phase}` : null}
          </p>
          <ProgressBar value={applyProgress} autoTone={false} label={stepLabel ?? t.updates.applying} />
        </div>
      ) : null}

      {phase && !applyStep ? (
        <p className="font-mono text-xs uppercase tracking-wider text-dockora-accent">{phase}</p>
      ) : null}
      {error ? <ErrorBanner message={error} /> : null}
      {success ? <SuccessBanner message={success} /> : null}
      {loading && items.length === 0 ? <LoadingState message={t.common.loading} /> : null}

      <div {...tabPanelProps(tabsId, filter)}>
        {!loading || items.length > 0 ? (
          filtered.length === 0 ? (
            <EmptyState message={t.updates.empty} />
          ) : (
            <ul className="dockora-panel divide-y divide-dockora-border">
              {filtered.map((u) => {
                const state = rowState(u);
                const { repo, tag } = splitImage(u.image);
                const err = u.error ? errorText(classifyError(u.error)) : null;
                const isBusy = busy === u.containerId;
                return (
                  <li
                    key={u.containerId}
                    className={cn(
                      'grid gap-3 px-4 py-4 transition-colors md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_auto] md:items-center md:gap-6',
                      state === 'available' && 'bg-dockora-warning/[0.03]',
                      isBusy && 'bg-dockora-blue/[0.06]',
                    )}
                  >
                    <div className="flex min-w-0 items-start gap-3">
                      <span
                        className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', STATE_DOT[state])}
                        aria-hidden
                      />
                      <div className="min-w-0 space-y-1">
                        <p className="truncate font-medium text-white" title={u.containerName}>
                          {u.containerName}
                        </p>
                        <p
                          className="truncate font-mono text-xs text-dockora-muted"
                          title={u.image}
                        >
                          {tag === null ? `${t.common.image} ${shortDigest(repo)}` : repo}
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {tag ? <Chip title={t.updates.currentTag}>{tag}</Chip> : null}
                          <Chip title={t.updates.registry}>
                            {REGISTRY_LABELS[u.registry] ?? u.registry}
                          </Chip>
                        </div>
                      </div>
                    </div>

                    <div className="min-w-0 space-y-1.5 pl-5 md:pl-0">
                      {err ? (
                        <>
                          <StatusBadge status="danger" label={err.label} />
                          <p className="text-xs leading-snug text-dockora-muted">{err.hint}</p>
                          <details className="group text-[11px]">
                            <summary className="cursor-pointer select-none font-display uppercase tracking-wider text-dockora-muted hover:text-dockora-text">
                              {t.updates.details}
                            </summary>
                            <p className="mt-1 break-all font-mono leading-snug text-dockora-danger">
                              {u.error}
                            </p>
                          </details>
                        </>
                      ) : state === 'available' ? (
                        <>
                          <StatusBadge status="warning" label={t.updates.available} />
                          <p
                            className="font-mono text-[11px] text-dockora-muted"
                            title={`${u.currentDigest ?? ''} → ${u.remoteDigest ?? ''}`}
                          >
                            {shortDigest(u.currentDigest)}{' '}
                            <span className="text-dockora-pink">→ {shortDigest(u.remoteDigest)}</span>
                          </p>
                        </>
                      ) : (
                        <StatusBadge status="success" label={t.updates.upToDate} />
                      )}
                    </div>

                    <div className="flex items-center justify-between gap-4 pl-5 md:flex-col md:items-end md:justify-center md:gap-1.5 md:pl-0">
                      <span
                        className="text-[11px] text-dockora-muted"
                        title={new Date(u.checkedAt).toLocaleString(loc)}
                      >
                        {t.updates.checkedAt} {formatRelativeTime(u.checkedAt, loc)}
                      </span>
                      {state === 'available' && canOps ? (
                        <Button
                          size="sm"
                          variant="primary"
                          disabled={Boolean(busy)}
                          onClick={() => setConfirm({ mode: 'one', id: u.containerId })}
                        >
                          {isBusy ? t.updates.applying : t.updates.pull}
                        </Button>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )
        ) : null}
      </div>

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
          const pending = confirm;
          setConfirm(null);
          if (pending.mode === 'one' && pending.id) {
            void runApplySteps([pending.id]);
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
