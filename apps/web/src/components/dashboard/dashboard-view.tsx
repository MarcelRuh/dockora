'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { DashboardOverview } from '@dockora/shared';
import { useAuth } from '@/components/auth/auth-provider';
import { useLocale } from '@/i18n/locale-provider';
import { ApiError, applyDockerHostUpdate, fetchDockerHostUpdateStatus } from '@/lib/api';
import { formatBytes, formatPercent, formatRelativeTime, usageRatio } from '@/lib/format';
import { canAdmin } from '@/lib/roles';
import { cn } from '@/lib/utils';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ProgressBar } from '@/components/ui/progress-bar';
import { Button } from '@/components/ui/form-controls';
import { ErrorBanner, SuccessBanner } from '@/components/ui/page-parts';
import type { UseDashboardResult } from '@/hooks/use-dashboard';

export function DashboardView({
  data,
  state,
  error,
  lastUpdated,
  refresh,
}: UseDashboardResult) {
  const { t, locale } = useLocale();
  const loc = locale === 'de' ? 'de-DE' : 'en-US';

  return (
    <div className="space-y-5 animate-in fade-in">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="dockora-title-gradient text-2xl tracking-tight sm:text-3xl">
          {t.dashboard.title}
        </h1>
        <LiveBadge
          state={state}
          lastUpdated={lastUpdated}
          labels={t.dashboard.live}
          locale={loc}
          onRefresh={() => void refresh()}
        />
      </header>

      {state === 'error' && !data ? (
        <p className="border border-dockora-danger/35 bg-dockora-danger/8 px-3 py-2 text-sm text-dockora-danger">
          {t.dashboard.loadError}: {error}
        </p>
      ) : null}

      {state === 'loading' && !data ? (
        <p className="text-sm text-dockora-muted">{t.dashboard.loading}</p>
      ) : null}

      {data ? (
        <div className="space-y-5">
          <EngineStrip overview={data} onUpdated={() => void refresh()} />
          <ContainerStrip overview={data} labels={t.dashboard} />
          <LifetimeStrip overview={data} labels={t.dashboard.lifetime} locale={loc} />
          <LiveResources overview={data} labels={t.dashboard} locale={loc} />
          <AsideColumn
            notifications={data.notifications}
            updatesAvailable={data.updatesAvailable}
            labels={t.dashboard}
            locale={loc}
          />
          {error ? (
            <p className="text-xs text-dockora-warning">
              {t.dashboard.staleWarning}: {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ContainerStrip({
  overview,
  labels,
}: {
  overview: DashboardOverview;
  labels: {
    containers: {
      title: string;
      total: string;
      running: string;
      stopped: string;
      unhealthy: string;
      unhealthyList: string;
      unhealthyEmpty: string;
    };
  };
}) {
  const stats = [
    { key: 'total', label: labels.containers.total, value: overview.containers.total, danger: false },
    { key: 'running', label: labels.containers.running, value: overview.containers.running, danger: false },
    { key: 'stopped', label: labels.containers.stopped, value: overview.containers.stopped, danger: false },
    {
      key: 'unhealthy',
      label: labels.containers.unhealthy,
      value: overview.containers.unhealthy,
      danger: overview.containers.unhealthy > 0,
    },
  ];

  const unhealthy = overview.unhealthyContainers ?? [];

  return (
    <section className="space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map((item) => (
          <Link
            key={item.key}
            href="/containers"
            className="dockora-panel px-4 py-3 transition-colors hover:border-dockora-pink/40"
          >
            <p className="text-xs font-medium uppercase tracking-wide text-dockora-muted">
              {item.label}
            </p>
            <p
              className={cn(
                'mt-1 font-mono text-2xl tabular-nums',
                item.danger ? 'text-dockora-danger' : 'dockora-stat-gradient',
              )}
            >
              {item.value}
            </p>
          </Link>
        ))}
      </div>
      {unhealthy.length > 0 ? (
        <div className="dockora-panel flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-3">
          <h3 className="text-xs font-medium uppercase tracking-wide text-dockora-danger">
            {labels.containers.unhealthyList}
          </h3>
          <ul className="flex flex-wrap gap-x-3 gap-y-1">
            {unhealthy.map((c) => (
              <li key={c.id} className="flex items-baseline gap-1.5 text-sm">
                <Link
                  href={`/containers/${encodeURIComponent(c.id)}`}
                  className="dockora-link font-mono"
                >
                  {c.name}
                </Link>
                {c.composeProject ? (
                  <span className="text-[11px] text-dockora-muted">{c.composeProject}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function LifetimeStrip({
  overview,
  labels,
  locale,
}: {
  overview: DashboardOverview;
  labels: {
    title: string;
    since: string;
    peakCpu: string;
    peakMemory: string;
    peakDisk: string;
    avgCpu: string;
    starts: string;
    maxContainers: string;
    samples: string;
  };
  locale: string;
}) {
  const life = overview.lifetime;
  if (!life || (life.samplesCount === 0 && life.containerStarts === 0)) return null;

  const since = new Date(life.trackingSince).toLocaleDateString(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
  const items = [
    { label: labels.peakCpu, value: `${life.peakCpuPercent.toFixed(1)}%` },
    { label: labels.avgCpu, value: `${life.avgCpuPercent.toFixed(1)}%` },
    { label: labels.peakMemory, value: `${life.peakMemoryPercent.toFixed(1)}%` },
    { label: labels.peakDisk, value: `${life.peakDiskPercent.toFixed(1)}%` },
    { label: labels.starts, value: String(life.containerStarts) },
    { label: labels.maxContainers, value: String(life.maxContainersSeen) },
  ];

  return (
    <section className="dockora-panel space-y-3 px-4 py-3" aria-label={labels.title}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-xs font-medium uppercase tracking-wide text-dockora-muted">
          {labels.title}
        </h2>
        <p className="font-mono text-[11px] text-dockora-muted">
          {labels.since} {since} · {labels.samples.replace('{count}', String(life.samplesCount))}
        </p>
      </div>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {items.map((item) => (
          <div key={item.label}>
            <dt className="text-[10px] uppercase tracking-wide text-dockora-muted">{item.label}</dt>
            <dd className="mt-0.5 font-mono text-lg tabular-nums text-dockora-text">{item.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function LiveResources({
  overview,
  labels,
  locale,
}: {
  overview: DashboardOverview;
  labels: {
    resources: {
      title: string;
      cpu: string;
      memory: string;
      disk: string;
      realtime: string;
      cores: string;
      core: string;
    };
  };
  locale: string;
}) {
  const memPct = usageRatio(
    overview.resources.memoryUsedBytes,
    overview.resources.memoryTotalBytes,
  );
  const diskPct = usageRatio(overview.resources.diskUsedBytes, overview.resources.diskTotalBytes);

  const cores = overview.resources.cpuCores;
  const coresLabel =
    cores !== null && cores > 0
      ? (cores === 1 ? labels.resources.core : labels.resources.cores).replace(
          '{count}',
          String(cores),
        )
      : null;

  const rows = [
    {
      key: 'cpu',
      label: labels.resources.cpu,
      primary: formatPercent(overview.resources.cpuPercent, locale),
      secondary: coresLabel,
      ratio: overview.resources.cpuPercent,
    },
    {
      key: 'mem',
      label: labels.resources.memory,
      primary: formatPercent(memPct, locale),
      secondary: `${formatBytes(overview.resources.memoryUsedBytes, locale)} / ${formatBytes(overview.resources.memoryTotalBytes, locale)}`,
      ratio: memPct,
    },
    {
      key: 'disk',
      label: labels.resources.disk,
      primary: formatPercent(diskPct, locale),
      secondary: `${formatBytes(overview.resources.diskUsedBytes, locale)} / ${formatBytes(overview.resources.diskTotalBytes, locale)}`,
      ratio: diskPct,
    },
  ];

  return (
    <section className="grid gap-3 sm:grid-cols-3">
      {rows.map((row) => (
        <div key={row.key} className="dockora-panel space-y-2 px-4 py-3">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-xs font-medium uppercase tracking-wide text-dockora-muted">
              {row.label}
            </p>
            <p className="dockora-stat-gradient font-mono text-xl tabular-nums">{row.primary}</p>
          </div>
          <ProgressBar value={row.ratio} />
          {row.secondary ? (
            <p className="font-mono text-[11px] text-dockora-muted">{row.secondary}</p>
          ) : null}
        </div>
      ))}
    </section>
  );
}

function LiveBadge({
  state,
  lastUpdated,
  labels,
  locale,
  onRefresh,
}: {
  state: UseDashboardResult['state'];
  lastUpdated: Date | null;
  labels: { live: string; updating: string; refresh: string; lastUpdate: string };
  locale: string;
  onRefresh: () => void;
}) {
  const isLive = state === 'ready' || state === 'loading';

  return (
    <div className="dockora-panel flex items-center gap-2 self-start px-2.5 py-1.5 sm:self-auto">
      <div className="flex items-center gap-2 text-[11px]">
        <span
          className={cn(
            'h-2 w-2 rounded-full',
            isLive ? 'dockora-pulse bg-dockora-pink shadow-neon-pink' : 'bg-dockora-danger',
          )}
        />
        <span className="font-semibold uppercase tracking-wide">
          {state === 'loading' && !lastUpdated ? labels.updating : labels.live}
        </span>
        {lastUpdated ? (
          <span className="hidden text-dockora-muted sm:inline">
            {labels.lastUpdate}{' '}
            {lastUpdated.toLocaleTimeString(locale, {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
            })}
          </span>
        ) : null}
      </div>
      <Button size="sm" onClick={onRefresh}>
        {labels.refresh}
      </Button>
    </div>
  );
}

type DockerUpdateTarget = 'engine' | 'compose';

async function waitForApiHealth(timeoutMs = 180_000): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch('/api/v1/health', { cache: 'no-store' });
      if (res.ok) return true;
    } catch {
      // API/engine restart
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
}

function EngineStrip({
  overview,
  onUpdated,
}: {
  overview: DashboardOverview;
  onUpdated: () => void;
}) {
  const { t } = useLocale();
  const labels = t.dashboard;
  const { authEnabled, user } = useAuth();
  const isAdmin = canAdmin(user?.role, authEnabled);
  const [busyTarget, setBusyTarget] = useState<DockerUpdateTarget | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<DockerUpdateTarget | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [progress, setProgress] = useState<{
    updating: boolean;
    target: DockerUpdateTarget | null;
    percent: number;
    step: string;
    detail: string | null;
    message: string | null;
    ok: boolean | null;
  } | null>(null);

  const loadProgress = useCallback(async () => {
    try {
      const next = await fetchDockerHostUpdateStatus();
      setProgress(next);
      if (next.updating && next.target) setBusyTarget(next.target);
    } catch {
      // API can drop during an engine restart
    }
  }, []);

  useEffect(() => {
    void loadProgress();
  }, [loadProgress]);

  useEffect(() => {
    if (!busyTarget && !progress?.updating) return;
    const timer = window.setInterval(() => void loadProgress(), 1000);
    return () => window.clearInterval(timer);
  }, [busyTarget, progress?.updating, loadProgress]);

  const statusLabel =
    overview.docker.engineStatus === 'online'
      ? labels.online
      : overview.docker.engineStatus === 'offline'
        ? labels.offline
        : labels.unknown;

  const applyUpdate = async (target: DockerUpdateTarget) => {
    setBusyTarget(target);
    setError(null);
    setSuccess(null);
    setProgress({
      updating: true,
      target,
      percent: 2,
      step: 'start',
      detail: null,
      message: null,
      ok: null,
    });
    try {
      const result = await applyDockerHostUpdate(target);
      setSuccess(result.message);
      await loadProgress();
      onUpdated();
    } catch (err) {
      const likelyRestart =
        target === 'engine' && (!(err instanceof ApiError) || err.status >= 500);
      if (likelyRestart) {
        setProgress((prev) =>
          prev
            ? { ...prev, percent: Math.max(prev.percent, 88), step: 'restart', updating: true }
            : prev,
        );
        setSuccess(labels.dockerUpdate.waitingHealth);
        const ok = await waitForApiHealth();
        if (ok) {
          setSuccess(null);
          await loadProgress();
          onUpdated();
        } else {
          setError(err instanceof Error ? err.message : t.common.failed);
        }
      } else {
        setError(err instanceof Error ? err.message : t.common.failed);
        await loadProgress();
      }
    } finally {
      setBusyTarget(null);
    }
  };

  const confirmCopy =
    confirmTarget === 'engine'
      ? {
          title: labels.dockerUpdate.confirmEngine.replace(
            '{version}',
            overview.docker.engineLatest ?? '',
          ),
          consequences: labels.dockerUpdate.consequencesEngine,
          danger: true,
        }
      : confirmTarget === 'compose'
        ? {
            title: labels.dockerUpdate.confirmCompose.replace(
              '{version}',
              overview.docker.composeLatest ?? '',
            ),
            consequences: labels.dockerUpdate.consequencesCompose,
            danger: false,
          }
        : null;

  return (
    <div className="space-y-3">
      {error ? <ErrorBanner message={error} /> : null}
      {success ? <SuccessBanner message={success} /> : null}
      <section className="grid gap-3 sm:grid-cols-3">
        <div className="dockora-panel px-4 py-3">
          <p className="text-xs font-medium uppercase tracking-wide text-dockora-muted">
            {labels.status}
          </p>
          <p
            className={cn(
              'mt-1 text-base font-semibold',
              overview.docker.engineStatus === 'online'
                ? 'text-dockora-success'
                : overview.docker.engineStatus === 'offline'
                  ? 'text-dockora-danger'
                  : 'text-dockora-muted',
            )}
          >
            {statusLabel}
          </p>
        </div>
        <VersionUpdateCard
          label={labels.engine}
          current={overview.docker.engineVersion}
          latest={overview.docker.engineLatest}
          updateAvailable={overview.docker.engineUpdateAvailable}
          unknownLabel={labels.versionUnknown}
          applyLabel={labels.dockerUpdate.apply}
          applyingLabel={labels.dockerUpdate.applying}
          percentLabel={labels.dockerUpdate.percent}
          stepLabels={labels.dockerUpdate.steps}
          showButton={isAdmin}
          busy={busyTarget !== null}
          applying={busyTarget === 'engine' || Boolean(progress?.updating && progress.target === 'engine')}
          progress={
            busyTarget === 'engine' || (progress?.updating && progress.target === 'engine')
              ? progress
              : null
          }
          onApply={() => setConfirmTarget('engine')}
        />
        <VersionUpdateCard
          label={labels.compose}
          current={overview.docker.composeVersion}
          latest={overview.docker.composeLatest}
          updateAvailable={overview.docker.composeUpdateAvailable}
          unknownLabel={labels.versionUnknown}
          applyLabel={labels.dockerUpdate.apply}
          applyingLabel={labels.dockerUpdate.applying}
          percentLabel={labels.dockerUpdate.percent}
          stepLabels={labels.dockerUpdate.steps}
          showButton={isAdmin}
          busy={busyTarget !== null}
          applying={busyTarget === 'compose' || Boolean(progress?.updating && progress.target === 'compose')}
          progress={
            busyTarget === 'compose' || (progress?.updating && progress.target === 'compose')
              ? progress
              : null
          }
          onApply={() => setConfirmTarget('compose')}
        />
      </section>
      <ConfirmDialog
        open={confirmTarget !== null}
        title={confirmCopy?.title ?? labels.dockerUpdate.apply}
        consequences={confirmCopy ? [...confirmCopy.consequences] : undefined}
        confirmLabel={t.common.confirm}
        cancelLabel={t.common.cancel}
        danger={confirmCopy?.danger ?? false}
        busy={busyTarget !== null}
        onCancel={() => setConfirmTarget(null)}
        onConfirm={() => {
          const target = confirmTarget;
          setConfirmTarget(null);
          if (target) void applyUpdate(target);
        }}
      />
    </div>
  );
}

function VersionUpdateCard({
  label,
  current,
  latest,
  updateAvailable,
  unknownLabel,
  applyLabel,
  applyingLabel,
  percentLabel,
  stepLabels,
  showButton,
  busy,
  applying,
  progress,
  onApply,
}: {
  label: string;
  current: string | null;
  latest: string | null;
  updateAvailable: boolean;
  unknownLabel: string;
  applyLabel: string;
  applyingLabel: string;
  percentLabel: string;
  stepLabels: Record<string, string>;
  showButton: boolean;
  busy: boolean;
  applying: boolean;
  progress: {
    percent: number;
    step: string;
    updating?: boolean;
  } | null;
  onApply: () => void;
}) {
  const showProgress = Boolean(applying && (progress || busy));
  const percent = progress?.percent ?? (showProgress ? 2 : 0);
  const stepLabel = (progress?.step && stepLabels[progress.step]) || applyingLabel;

  return (
    <div className="dockora-panel flex flex-col gap-2 px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-dockora-muted">{label}</p>
          <p className="mt-1 truncate font-mono text-base font-semibold">
            {current ?? unknownLabel}
            {updateAvailable && latest ? (
              <span className="text-dockora-warning"> → {latest}</span>
            ) : null}
          </p>
        </div>
        {showButton && updateAvailable && !showProgress ? (
          <Button size="sm" variant="primary" disabled={busy} onClick={onApply}>
            {applyLabel}
          </Button>
        ) : null}
      </div>
      {showProgress ? (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[11px] uppercase tracking-wide text-dockora-blue">{stepLabel}</p>
            <span className="font-mono text-[11px] text-dockora-muted">
              {percentLabel.replace('{percent}', String(Math.round(percent)))}
            </span>
          </div>
          <ProgressBar value={percent} autoTone={false} tone={progress?.step === 'error' ? 'danger' : 'accent'} />
        </div>
      ) : null}
    </div>
  );
}

function AsideColumn({
  notifications,
  updatesAvailable,
  labels,
  locale,
}: {
  notifications: DashboardOverview['notifications'];
  updatesAvailable: number;
  labels: {
    notifications: { title: string; empty: string };
    updates: { title: string; none: string; available: string };
  };
  locale: string;
}) {
  const latestNotes = notifications.slice(0, 4);

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <Link
        href="/updates"
        className="dockora-panel px-4 py-3 transition-colors hover:border-dockora-pink/40"
      >
        <h2 className="text-xs font-medium uppercase tracking-wide text-dockora-muted">
          {labels.updates.title}
        </h2>
        <p
          className={cn(
            'mt-2 text-sm',
            updatesAvailable > 0 ? 'text-dockora-warning' : 'text-dockora-muted',
          )}
        >
          {updatesAvailable > 0
            ? labels.updates.available.replace('{count}', String(updatesAvailable))
            : labels.updates.none}
        </p>
      </Link>

      <section className="dockora-panel px-4 py-3">
        <h2 className="text-xs font-medium uppercase tracking-wide text-dockora-muted">
          {labels.notifications.title}
        </h2>
        {latestNotes.length === 0 ? (
          <p className="mt-2 text-sm text-dockora-muted">{labels.notifications.empty}</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {latestNotes.map((n) => (
              <li
                key={n.id}
                className="border border-dockora-border bg-dockora-surface2/40 px-3 py-2"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <p className="truncate text-sm font-medium">{n.title}</p>
                  <time className="shrink-0 font-mono text-[11px] text-dockora-muted">
                    {formatRelativeTime(n.timestamp, locale)}
                  </time>
                </div>
                {n.message ? (
                  <p className="mt-0.5 line-clamp-2 text-xs text-dockora-muted">{n.message}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
