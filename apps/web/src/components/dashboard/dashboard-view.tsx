'use client';

import type { DashboardOverview } from '@dockora/shared';
import { useLocale } from '@/i18n/locale-provider';
import { formatBytes, formatPercent, formatRelativeTime, usageRatio } from '@/lib/format';
import { cn } from '@/lib/utils';
import { ProgressBar } from '@/components/ui/progress-bar';
import { Button } from '@/components/ui/form-controls';
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
    <div className="space-y-8 animate-in fade-in">
      <header className="space-y-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-2">
            <p className="dockora-section-tag">
              Dockora · {t.dashboard.live.live}
            </p>
            <h1 className="dockora-title-gradient text-4xl tracking-tight sm:text-5xl">
              {t.dashboard.title}
            </h1>
            <p className="max-w-xl text-sm text-dockora-muted sm:text-base">{t.dashboard.subtitle}</p>
          </div>
          <LiveBadge
            state={state}
            lastUpdated={lastUpdated}
            labels={t.dashboard.live}
            locale={loc}
            onRefresh={() => void refresh()}
          />
        </div>
        <div className="dockora-neon-line" />
      </header>

      {state === 'error' && !data ? (
        <p className="border border-dockora-danger/35 bg-dockora-danger/8 px-4 py-3 text-sm text-dockora-danger">
          {t.dashboard.loadError}: {error}
        </p>
      ) : null}

      {state === 'loading' && !data ? (
        <p className="text-sm text-dockora-muted">{t.dashboard.loading}</p>
      ) : null}

      {data ? (
        <div className="space-y-8">
          <EngineStrip overview={data} labels={t.dashboard} />
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
    <section className="space-y-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="dockora-title-gradient text-lg tracking-tight">{labels.resources.title}</h2>
        <p className="dockora-section-tag !mb-0">{labels.resources.realtime}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {rows.map((row) => (
          <div key={row.key} className="dockora-panel space-y-3 p-4">
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-sm font-medium text-dockora-muted">{row.label}</p>
              <p className="dockora-stat-gradient font-mono text-2xl tabular-nums">{row.primary}</p>
            </div>
            <ProgressBar value={row.ratio} />
            {row.secondary ? (
              <p className="font-mono text-[11px] text-dockora-muted">{row.secondary}</p>
            ) : null}
          </div>
        ))}
      </div>
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
    <div className="dockora-panel flex items-center gap-3 self-start px-3 py-2 sm:self-auto">
      <div className="flex items-center gap-2 text-xs">
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
      <Button onClick={onRefresh}>{labels.refresh}</Button>
    </div>
  );
}

function EngineStrip({
  overview,
  labels,
}: {
  overview: DashboardOverview;
  labels: {
    engine: string;
    compose: string;
    status: string;
    online: string;
    offline: string;
    unknown: string;
    versionUnknown: string;
  };
}) {
  const statusLabel =
    overview.docker.engineStatus === 'online'
      ? labels.online
      : overview.docker.engineStatus === 'offline'
        ? labels.offline
        : labels.unknown;

  return (
    <section className="grid gap-3 sm:grid-cols-3">
      {[
        {
          label: labels.status,
          value: statusLabel,
          className:
            overview.docker.engineStatus === 'online'
              ? 'text-dockora-success'
              : overview.docker.engineStatus === 'offline'
                ? 'text-dockora-danger'
                : 'text-dockora-muted',
        },
        {
          label: labels.engine,
          value: overview.docker.engineVersion ?? labels.versionUnknown,
          className: 'font-mono',
        },
        {
          label: labels.compose,
          value: overview.docker.composeVersion ?? labels.versionUnknown,
          className: 'font-mono',
        },
      ].map((item) => (
        <div key={item.label} className="dockora-panel px-4 py-4">
          <p className="text-xs font-medium uppercase tracking-wide text-dockora-muted">
            {item.label}
          </p>
          <p className={cn('mt-1 text-lg font-semibold', item.className)}>{item.value}</p>
        </div>
      ))}
    </section>
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
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <section className="dockora-panel px-4 py-4">
        <h2 className="dockora-title-gradient text-base">{labels.updates.title}</h2>
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
      </section>

      <section className="dockora-panel px-4 py-4">
        <h2 className="dockora-title-gradient text-base">{labels.notifications.title}</h2>
        {notifications.length === 0 ? (
          <p className="mt-2 text-sm text-dockora-muted">{labels.notifications.empty}</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {notifications.map((n) => (
              <li
                key={n.id}
                className="border border-dockora-border bg-dockora-surface2/40 px-3 py-2"
              >
                <p className="text-sm font-medium">{n.title}</p>
                <p className="text-xs text-dockora-muted">{n.message}</p>
                <time className="font-mono text-[11px] text-dockora-muted">
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
