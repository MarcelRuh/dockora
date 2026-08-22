'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { DashboardOverview } from '@dockora/shared';
import { useAuth } from '@/components/auth/auth-provider';
import { useLocale } from '@/i18n/locale-provider';
import { ApiError, applyDockerHostUpdate } from '@/lib/api';
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
    <div className="space-y-3 animate-in fade-in">
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
        <div className="space-y-3">
          <EngineStrip overview={data} onUpdated={() => void refresh()} />
          <ContainerStrip overview={data} labels={t.dashboard} />
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
    <section className="space-y-2">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {stats.map((item) => (
          <Link
            key={item.key}
            href="/containers"
            className="dockora-panel px-3 py-2.5 transition-colors hover:border-dockora-pink/40"
          >
            <p className="text-[10px] font-medium uppercase tracking-wide text-dockora-muted">
              {item.label}
            </p>
            <p
              className={cn(
                'mt-0.5 font-mono text-xl tabular-nums',
                item.danger ? 'text-dockora-danger' : 'dockora-stat-gradient',
              )}
            >
              {item.value}
            </p>
          </Link>
        ))}
      </div>
      {unhealthy.length > 0 ? (
        <div className="dockora-panel flex flex-wrap items-baseline gap-x-3 gap-y-1 px-3 py-2">
          <h3 className="text-[10px] font-medium uppercase tracking-wide text-dockora-danger">
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
    <section className="grid gap-2 sm:grid-cols-3">
      {rows.map((row) => (
        <div key={row.key} className="dockora-panel space-y-1.5 px-3 py-2.5">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-[10px] font-medium uppercase tracking-wide text-dockora-muted">
              {row.label}
            </p>
            <p className="dockora-stat-gradient font-mono text-lg tabular-nums">{row.primary}</p>
          </div>
          <ProgressBar value={row.ratio} className="h-1.5" />
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
    try {
      const result = await applyDockerHostUpdate(target);
      setSuccess(result.message);
      onUpdated();
    } catch (err) {
      const likelyRestart =
        target === 'engine' && (!(err instanceof ApiError) || err.status >= 500);
      if (likelyRestart) {
        setSuccess(labels.dockerUpdate.waitingHealth);
        const ok = await waitForApiHealth();
        if (ok) {
          setSuccess(null);
          onUpdated();
        } else {
          setError(err instanceof Error ? err.message : t.common.failed);
        }
      } else {
        setError(err instanceof Error ? err.message : t.common.failed);
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
    <div className="space-y-2">
      {error ? <ErrorBanner message={error} /> : null}
      {success ? <SuccessBanner message={success} /> : null}
      <section className="grid gap-2 sm:grid-cols-3">
        <div className="dockora-panel px-3 py-2.5">
          <p className="text-[10px] font-medium uppercase tracking-wide text-dockora-muted">
            {labels.status}
          </p>
          <p
            className={cn(
              'mt-0.5 text-sm font-semibold',
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
          showButton={isAdmin}
          busy={busyTarget !== null}
          applying={busyTarget === 'engine'}
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
          showButton={isAdmin}
          busy={busyTarget !== null}
          applying={busyTarget === 'compose'}
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
  showButton,
  busy,
  applying,
  onApply,
}: {
  label: string;
  current: string | null;
  latest: string | null;
  updateAvailable: boolean;
  unknownLabel: string;
  applyLabel: string;
  applyingLabel: string;
  showButton: boolean;
  busy: boolean;
  applying: boolean;
  onApply: () => void;
}) {
  return (
    <div className="dockora-panel flex items-center justify-between gap-2 px-3 py-2.5">
      <div className="min-w-0">
        <p className="text-[10px] font-medium uppercase tracking-wide text-dockora-muted">{label}</p>
        <p className="mt-0.5 truncate font-mono text-sm font-semibold">
          {current ?? unknownLabel}
          {updateAvailable && latest ? (
            <span className="text-dockora-warning"> → {latest}</span>
          ) : null}
        </p>
      </div>
      {showButton && updateAvailable ? (
        <Button size="sm" variant="primary" disabled={busy} onClick={onApply}>
          {applying ? applyingLabel : applyLabel}
        </Button>
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
  const latestNotes = notifications.slice(0, 3);

  return (
    <div className="grid gap-2 lg:grid-cols-2">
      <Link
        href="/updates"
        className="dockora-panel px-3 py-2.5 transition-colors hover:border-dockora-pink/40"
      >
        <h2 className="text-[10px] font-medium uppercase tracking-wide text-dockora-muted">
          {labels.updates.title}
        </h2>
        <p
          className={cn(
            'mt-1 text-sm',
            updatesAvailable > 0 ? 'text-dockora-warning' : 'text-dockora-muted',
          )}
        >
          {updatesAvailable > 0
            ? labels.updates.available.replace('{count}', String(updatesAvailable))
            : labels.updates.none}
        </p>
      </Link>

      <section className="dockora-panel px-3 py-2.5">
        <h2 className="text-[10px] font-medium uppercase tracking-wide text-dockora-muted">
          {labels.notifications.title}
        </h2>
        {latestNotes.length === 0 ? (
          <p className="mt-1 text-sm text-dockora-muted">{labels.notifications.empty}</p>
        ) : (
          <ul className="mt-1.5 space-y-1">
            {latestNotes.map((n) => (
              <li key={n.id} className="flex items-baseline justify-between gap-3">
                <p className="truncate text-sm">{n.title}</p>
                <time className="shrink-0 font-mono text-[11px] text-dockora-muted">
                  {formatRelativeTime(n.timestamp, locale)}
                </time>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
