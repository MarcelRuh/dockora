'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { DashboardOverview, Locale } from '@dockora/shared';
import { AuthLogoutButton } from '@/components/auth/auth-provider';
import { GlobalSearch } from '@/components/global-search';
import { NAV_ICONS } from '@/components/ui/nav-icons';
import { useLocale } from '@/i18n/locale-provider';
import { formatBytes, formatPercent, usageRatio } from '@/lib/format';
import { cn } from '@/lib/utils';

const APPS = [
  { key: 'containers', href: '/containers' },
  { key: 'compose', href: '/compose' },
  { key: 'images', href: '/images' },
  { key: 'volumes', href: '/volumes' },
  { key: 'updates', href: '/updates' },
  { key: 'monitoring', href: '/monitoring' },
  { key: 'network', href: '/network' },
  { key: 'backups', href: '/backups' },
  { key: 'logs', href: '/logs' },
  { key: 'terminal', href: '/terminal' },
  { key: 'selfUpdate', href: '/self-update' },
  { key: 'settings', href: '/settings' },
] as const;

type AppKey = (typeof APPS)[number]['key'];

const TILE: Record<AppKey, string> = {
  containers: 'bg-gradient-to-br from-dockora-pink to-dockora-purple',
  compose: 'bg-gradient-to-br from-dockora-purple to-dockora-blue',
  images: 'bg-gradient-to-br from-dockora-blue to-dockora-purple',
  volumes: 'bg-gradient-to-br from-dockora-success to-dockora-blue',
  updates: 'bg-gradient-to-br from-dockora-pink to-dockora-danger',
  monitoring: 'bg-gradient-to-br from-dockora-blue to-dockora-success',
  network: 'bg-gradient-to-br from-dockora-purple to-dockora-pink',
  backups: 'bg-gradient-to-br from-dockora-blue to-dockora-purple',
  logs: 'bg-gradient-to-br from-dockora-muted to-dockora-purple',
  terminal: 'bg-gradient-to-br from-dockora-pink to-dockora-blue',
  selfUpdate: 'bg-gradient-to-br from-dockora-pink to-dockora-purple',
  settings: 'bg-gradient-to-br from-dockora-purple to-dockora-surface2',
};

const ORDER_KEY = 'dockora.home.appOrder';
const WIDGET_KEY = 'dockora.home.widgets';
const HINT_KEY = 'dockora.home.dragHint';

type Widgets = { system: boolean; storage: boolean; network: boolean };

const DEFAULT_WIDGETS: Widgets = { system: true, storage: true, network: true };

function readOrder(): AppKey[] {
  const known = new Set<string>(APPS.map((app) => app.key));
  try {
    const raw = JSON.parse(localStorage.getItem(ORDER_KEY) ?? '[]') as unknown;
    const saved = Array.isArray(raw) ? raw.filter((key): key is AppKey => known.has(String(key))) : [];
    const missing = APPS.map((app) => app.key).filter((key) => !saved.includes(key));
    return [...saved, ...missing];
  } catch {
    return APPS.map((app) => app.key);
  }
}

function readWidgets(): Widgets {
  try {
    const raw = JSON.parse(localStorage.getItem(WIDGET_KEY) ?? '{}') as Partial<Widgets>;
    return {
      system: raw.system !== false,
      storage: raw.storage !== false,
      network: raw.network !== false,
    };
  } catch {
    return DEFAULT_WIDGETS;
  }
}

export function CasaDesktop({ overview }: { overview: DashboardOverview }) {
  const { t, locale, setLocale } = useLocale();
  const loc = locale === 'de' ? 'de-DE' : 'en-US';
  const home = t.dashboard.home;
  const [order, setOrder] = useState<AppKey[]>(() => APPS.map((app) => app.key));
  const [widgets, setWidgets] = useState<Widgets>(DEFAULT_WIDGETS);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [hint, setHint] = useState(true);
  const [dragKey, setDragKey] = useState<AppKey | null>(null);
  const dragged = useRef(false);

  useEffect(() => {
    setOrder(readOrder());
    setWidgets(readWidgets());
    setHint(localStorage.getItem(HINT_KEY) !== '0');
  }, []);

  const apps = useMemo(
    () => order.map((key) => APPS.find((app) => app.key === key)).filter((app) => app != null),
    [order],
  );

  const saveOrder = (next: AppKey[]) => {
    setOrder(next);
    localStorage.setItem(ORDER_KEY, JSON.stringify(next));
  };

  const dropOn = (target: AppKey) => {
    if (!dragKey || dragKey === target) return;
    const next = order.filter((key) => key !== dragKey);
    const index = next.indexOf(target);
    next.splice(index < 0 ? next.length : index, 0, dragKey);
    saveOrder(next);
    setDragKey(null);
  };

  const setWidget = (key: keyof Widgets, value: boolean) => {
    const next = { ...widgets, [key]: value };
    setWidgets(next);
    localStorage.setItem(WIDGET_KEY, JSON.stringify(next));
  };

  const running = overview.containers.running;
  const total = overview.containers.total;
  const unhealthy = overview.unhealthyContainers ?? [];
  const engineLabel =
    overview.docker.engineStatus === 'online'
      ? t.dashboard.online
      : overview.docker.engineStatus === 'offline'
        ? t.dashboard.offline
        : t.dashboard.unknown;

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[17.5rem_minmax(0,1fr)]">
      <div className="flex flex-col gap-3">
        <ClockCard locale={loc} />
        {widgets.system ? (
          <SystemCard
            overview={overview}
            locale={loc}
            title={home.systemStatus}
            cores={t.dashboard.resources}
          />
        ) : null}
        {widgets.storage ? (
          <StorageCard overview={overview} locale={loc} labels={home} diskLabel={t.dashboard.resources.disk} />
        ) : null}
        {widgets.network ? <NetworkCard overview={overview} locale={loc} labels={home} /> : null}
        <div className="relative">
          <button
            type="button"
            className="dockora-glass flex w-full items-center justify-between px-4 py-3 text-sm text-dockora-text"
            onClick={() => setSettingsOpen((open) => !open)}
            aria-expanded={settingsOpen}
          >
            {home.widgetSettings}
            <Chevron />
          </button>
          {settingsOpen ? (
            <div className="dockora-glass absolute left-0 right-0 z-20 mt-2 space-y-2 px-4 py-3 text-sm">
              <WidgetToggle
                label={home.showSystem}
                checked={widgets.system}
                onChange={(value) => setWidget('system', value)}
              />
              <WidgetToggle
                label={home.showStorage}
                checked={widgets.storage}
                onChange={(value) => setWidget('storage', value)}
              />
              <WidgetToggle
                label={home.showNetwork}
                checked={widgets.network}
                onChange={(value) => setWidget('network', value)}
              />
            </div>
          ) : null}
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex items-center gap-2">
          <GlobalSearch className="rounded-full border-white/10 bg-black/30 px-4 py-3 font-sans text-sm normal-case tracking-normal" />
          <select
            aria-label={t.locale.label}
            className="dockora-glass h-11 shrink-0 bg-transparent px-3 font-mono text-xs"
            value={locale}
            onChange={(e) => setLocale(e.target.value as Locale)}
          >
            <option value="de">DE</option>
            <option value="en">EN</option>
          </select>
          <AuthLogoutButton className="w-auto shrink-0 px-3" />
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <FeatureCard
            href="/containers"
            title={t.nav.containers}
            body={home.runningHint.replace('{running}', String(running)).replace('{total}', String(total))}
            action={home.open}
            tone="pink"
            alert={unhealthy.length > 0 ? unhealthy.map((item) => item.name).join(', ') : null}
          />
          <FeatureCard
            href={overview.updatesAvailable > 0 ? '/updates' : '/monitoring'}
            title={t.dashboard.engine}
            body={
              overview.updatesAvailable > 0
                ? home.updatesHint.replace('{count}', String(overview.updatesAvailable))
                : home.engineHint
                    .replace('{status}', engineLabel)
                    .replace('{version}', overview.docker.engineVersion ?? t.dashboard.versionUnknown)
            }
            action={home.open}
            tone="cyan"
          />
        </div>

        <section aria-label={home.apps}>
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-sm font-medium text-dockora-text">{home.apps}</h2>
            {hint ? (
              <p className="flex items-center gap-2 rounded-md bg-black/45 px-2 py-1 text-xs text-white">
                {home.dragHint}
                <button
                  type="button"
                  className="text-dockora-muted hover:text-white"
                  aria-label={t.common.close}
                  onClick={() => {
                    setHint(false);
                    localStorage.setItem(HINT_KEY, '0');
                  }}
                >
                  ×
                </button>
              </p>
            ) : null}
          </div>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
            {apps.map((app) => {
              const Icon = NAV_ICONS[app.key];
              return (
                <li key={app.key}>
                  <Link
                    href={app.href}
                    draggable={dragKey === app.key}
                    onPointerDown={(event) => {
                      const startX = event.clientX;
                      const startY = event.clientY;
                      const target = event.currentTarget;
                      const move = (ev: PointerEvent) => {
                        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) > 8) {
                          dragged.current = true;
                          target.draggable = true;
                          setDragKey(app.key);
                        }
                      };
                      const up = () => {
                        window.removeEventListener('pointermove', move);
                        window.removeEventListener('pointerup', up);
                      };
                      window.addEventListener('pointermove', move);
                      window.addEventListener('pointerup', up);
                    }}
                    onDragStart={() => {
                      dragged.current = true;
                      setDragKey(app.key);
                    }}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={() => dropOn(app.key)}
                    onDragEnd={(event) => {
                      event.currentTarget.draggable = false;
                      setDragKey(null);
                    }}
                    onClick={(event) => {
                      if (!dragged.current) return;
                      event.preventDefault();
                      dragged.current = false;
                    }}
                    className={cn(
                      'dockora-glass flex h-full flex-col items-center justify-center gap-3 px-3 py-5 text-center transition-transform hover:-translate-y-0.5',
                      dragKey === app.key && 'opacity-50',
                    )}
                  >
                    <span
                      className={cn(
                        'flex h-14 w-14 items-center justify-center rounded-2xl text-white shadow-neon-soft',
                        TILE[app.key],
                      )}
                    >
                      <Icon className="h-7 w-7" />
                    </span>
                    <span className="text-sm text-dockora-text">{t.nav[app.key]}</span>
                  </Link>
                </li>
              );
            })}
            <li>
              <Link
                href="/compose/new"
                className="dockora-glass flex h-full min-h-[8.5rem] flex-col items-center justify-center gap-2 px-3 py-5 text-dockora-muted hover:text-white"
                aria-label={home.add}
              >
                <span className="text-3xl leading-none">+</span>
                <span className="text-xs">{home.add}</span>
              </Link>
            </li>
          </ul>
        </section>
      </div>
    </div>
  );
}

function ClockCard({ locale }: { locale: string }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return (
    <section className="dockora-glass px-5 py-4">
      <p className="font-display text-4xl tracking-wide">
        {now.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}
      </p>
      <p className="mt-1 text-sm capitalize text-dockora-muted">
        {now.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
      </p>
    </section>
  );
}

function SystemCard({
  overview,
  locale,
  title,
  cores,
}: {
  overview: DashboardOverview;
  locale: string;
  title: string;
  cores: { core: string; cores: string };
}) {
  const mem = usageRatio(overview.resources.memoryUsedBytes, overview.resources.memoryTotalBytes);
  const temp = overview.resources.temperatureC;
  return (
    <section className="dockora-glass px-4 py-3">
      <CardTitle href="/monitoring">{title}</CardTitle>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Gauge label="CPU" value={overview.resources.cpuPercent} locale={locale} tone="pink" />
        <Gauge label="RAM" value={mem} locale={locale} tone="cyan" />
      </div>
      <p className="mt-2 text-center font-mono text-xs text-dockora-muted">
        {temp != null ? `${temp.toFixed(0)}°C` : null}
        {temp != null && overview.resources.cpuCores ? ' · ' : null}
        {overview.resources.cpuCores
          ? (overview.resources.cpuCores === 1
              ? cores.core
              : cores.cores
            ).replace('{count}', String(overview.resources.cpuCores))
          : null}
      </p>
    </section>
  );
}

function StorageCard({
  overview,
  locale,
  labels,
  diskLabel,
}: {
  overview: DashboardOverview;
  locale: string;
  labels: { storage: string; healthy: string; used: string; total: string };
  diskLabel: string;
}) {
  const ratio = usageRatio(overview.resources.diskUsedBytes, overview.resources.diskTotalBytes);
  const healthy = ratio == null || ratio < 90;
  return (
    <section className="dockora-glass px-4 py-3">
      <CardTitle href="/monitoring">{labels.storage}</CardTitle>
      <div className="mt-3 flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-dockora-blue/15 text-dockora-blue">
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.75">
            <ellipse cx="12" cy="7" rx="7" ry="3" />
            <path d="M5 7v10c0 1.7 3.1 3 7 3s7-1.3 7-3V7" />
          </svg>
        </span>
        <div className="min-w-0">
          <p className="text-sm">{diskLabel}</p>
          <p className={cn('text-xs', healthy ? 'text-dockora-success' : 'text-dockora-warning')}>
            {healthy ? labels.healthy : formatPercent(ratio, locale)}
          </p>
        </div>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full bg-gradient-to-r from-dockora-pink to-dockora-blue"
          style={{ width: `${Math.max(2, ratio ?? 0)}%` }}
        />
      </div>
      <p className="mt-2 flex justify-between font-mono text-[11px] text-dockora-muted">
        <span>
          {labels.used}: {formatBytes(overview.resources.diskUsedBytes, locale)}
        </span>
        <span>
          {labels.total}: {formatBytes(overview.resources.diskTotalBytes, locale)}
        </span>
      </p>
    </section>
  );
}

function NetworkCard({
  overview,
  locale,
  labels,
}: {
  overview: DashboardOverview;
  locale: string;
  labels: { network: string; rx: string; tx: string };
}) {
  const rx = overview.resources.networkRxBytesPerSec;
  const tx = overview.resources.networkTxBytesPerSec;
  const [history, setHistory] = useState<Array<{ rx: number; tx: number }>>([]);

  useEffect(() => {
    if (rx == null || tx == null) return;
    setHistory((prev) => [...prev, { rx, tx }].slice(-24));
  }, [rx, tx]);

  return (
    <section className="dockora-glass px-4 py-3">
      <CardTitle href="/network">{labels.network}</CardTitle>
      <p className="mt-1 font-mono text-[11px] text-dockora-muted">{overview.resources.networkInterface ?? '—'}</p>
      <RateChart history={history} />
      <p className="mt-2 flex justify-between font-mono text-[11px] text-dockora-muted">
        <span className="text-dockora-blue">
          {labels.rx} {formatRate(rx, locale)}
        </span>
        <span className="text-dockora-pink">
          {labels.tx} {formatRate(tx, locale)}
        </span>
      </p>
    </section>
  );
}

function RateChart({ history }: { history: Array<{ rx: number; tx: number }> }) {
  const width = 240;
  const height = 72;
  const max = Math.max(1, ...history.map((point) => Math.max(point.rx, point.tx)));
  const line = (key: 'rx' | 'tx') => {
    if (history.length < 2) return '';
    return history
      .map((point, index) => {
        const x = (index / (history.length - 1)) * width;
        const y = height - (point[key] / max) * (height - 4) - 2;
        return `${x},${y}`;
      })
      .join(' ');
  };
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="mt-2 h-16 w-full" aria-hidden>
      {[0, 1, 2, 3].map((row) => (
        <line
          key={row}
          x1="0"
          x2={width}
          y1={(height / 4) * row}
          y2={(height / 4) * row}
          stroke="rgba(136,136,170,0.25)"
          strokeWidth="1"
        />
      ))}
      <polyline fill="none" stroke="#00b4d8" strokeWidth="2" points={line('rx')} />
      <polyline fill="none" stroke="#ff006e" strokeWidth="2" points={line('tx')} />
    </svg>
  );
}

function formatRate(value: number | null, locale: string): string {
  if (value == null) return '—';
  return `${formatBytes(value, locale)}/s`;
}

function Gauge({
  label,
  value,
  locale,
  tone,
}: {
  label: string;
  value: number | null;
  locale: string;
  tone: 'pink' | 'cyan';
}) {
  const pct = value == null ? 0 : Math.max(0, Math.min(100, value));
  const radius = 28;
  const circ = 2 * Math.PI * radius;
  const color = tone === 'pink' ? '#ff006e' : '#00b4d8';
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative h-[4.5rem] w-[4.5rem]">
        <svg viewBox="0 0 72 72" className="h-full w-full">
          <circle cx="36" cy="36" r={radius} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="6" />
          <circle
            cx="36"
            cy="36"
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={`${(pct / 100) * circ} ${circ}`}
            transform="rotate(-90 36 36)"
          />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center font-mono text-xs">
          {formatPercent(value, locale)}
        </span>
      </div>
      <span className="text-[11px] uppercase tracking-wide text-dockora-muted">{label}</span>
    </div>
  );
}

function CardTitle({ href, children }: { href: string; children: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <h2 className="text-sm font-medium">{children}</h2>
      <Link href={href} className="text-dockora-muted hover:text-white" aria-label={children}>
        <Chevron />
      </Link>
    </div>
  );
}

function Chevron() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

function WidgetToggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3">
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    </label>
  );
}

function FeatureCard({
  href,
  title,
  body,
  action,
  tone,
  alert,
}: {
  href: string;
  title: string;
  body: string;
  action: string;
  tone: 'pink' | 'cyan';
  alert?: string | null;
}) {
  return (
    <Link href={href} className="dockora-glass flex min-h-[9.5rem] flex-col justify-between px-5 py-4">
      <div>
        <h2 className="text-lg font-medium">{title}</h2>
        <p className="mt-1 text-sm text-dockora-muted">{body}</p>
        {alert ? <p className="mt-1 truncate text-xs text-dockora-danger">{alert}</p> : null}
      </div>
      <span
        className={cn(
          'mt-4 inline-flex w-fit rounded-full px-3 py-1 text-xs font-medium text-white',
          tone === 'pink' ? 'bg-dockora-pink' : 'bg-dockora-blue',
        )}
      >
        {action}
      </span>
    </Link>
  );
}
