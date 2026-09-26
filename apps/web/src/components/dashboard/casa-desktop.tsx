'use client';

import Link from 'next/link';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import type { ContainerSummary, DashboardOverview, Locale, UpdateCheckResult } from '@dockora/shared';
import { AuthLogoutButton, useAuth } from '@/components/auth/auth-provider';
import { BrandLogoWide } from '@/components/ui/brand-logo';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { NAV_ICONS } from '@/components/ui/nav-icons';
import { ServiceIcon } from '@/components/ui/service-icon';
import { useLocale } from '@/i18n/locale-provider';
import {
  composeAction,
  fetchComposeProject,
  fetchComposeProjects,
  fetchContainers,
  fetchUpdates,
  pullUpdate,
  saveComposeYaml,
} from '@/lib/api';
import { resolveContainerAppHref } from '@/lib/container-app-link';
import { resolveContainerIconUrl } from '@/lib/container-icon';
import { setComposeServiceUrl } from '@/lib/compose-icon-yaml';
import { formatBytes, formatPercent, usageRatio } from '@/lib/format';
import { canOperate } from '@/lib/roles';
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
const DOCK_KEYS = ['containers', 'compose', 'terminal', 'settings'] as const;
type DockKey = (typeof DOCK_KEYS)[number];

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
const CONTAINER_ORDER_KEY = 'dockora.home.containerOrder';
const URL_KEY = 'dockora.home.appUrls';
const WIDGET_KEY = 'dockora.home.widgets';
const HINT_KEY = 'dockora.home.dragHint';

type Widgets = { system: boolean; storage: boolean; network: boolean };

const DEFAULT_WIDGETS: Widgets = { system: true, storage: true, network: true };

function readOrder(): DockKey[] {
  const known = new Set<string>(DOCK_KEYS);
  try {
    const raw = JSON.parse(localStorage.getItem(ORDER_KEY) ?? '[]') as unknown;
    const saved = Array.isArray(raw) ? raw.filter((key): key is DockKey => known.has(String(key))) : [];
    const missing = DOCK_KEYS.filter((key) => !saved.includes(key));
    return [...saved, ...missing];
  } catch {
    return [...DOCK_KEYS];
  }
}

function readUrlOverrides(): Record<string, string> {
  try {
    const raw = JSON.parse(localStorage.getItem(URL_KEY) ?? '{}') as unknown;
    if (!raw || typeof raw !== 'object') return {};
    return Object.fromEntries(
      Object.entries(raw).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
    );
  } catch {
    return {};
  }
}

function withUrlOverride(container: ContainerSummary, overrides: Record<string, string>): ContainerSummary {
  if (!Object.prototype.hasOwnProperty.call(overrides, container.name)) return container;
  const stored = overrides[container.name] ?? '';
  if (!stored) {
    const labels = { ...container.labels };
    delete labels.url;
    delete labels['dockora.url'];
    delete labels['homepage.href'];
    delete labels['net.unraid.docker.webui'];
    return { ...container, labels };
  }
  return { ...container, labels: { ...container.labels, url: stored } };
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

export function CasaDesktop({
  overview,
  onOpenEngine,
}: {
  overview: DashboardOverview;
  onOpenEngine: () => void;
}) {
  const { t, locale, setLocale } = useLocale();
  const { authEnabled, user } = useAuth();
  const canEdit = canOperate(user?.role, authEnabled);
  const loc = locale === 'de' ? 'de-DE' : 'en-US';
  const home = t.dashboard.home;
  const [order, setOrder] = useState<DockKey[]>(() => [...DOCK_KEYS]);
  const [widgets, setWidgets] = useState<Widgets>(DEFAULT_WIDGETS);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [hint, setHint] = useState(true);
  const [dragKey, setDragKey] = useState<DockKey | null>(null);
  const [query, setQuery] = useState('');
  const [urlOverrides, setUrlOverrides] = useState<Record<string, string>>({});
  const [editingName, setEditingName] = useState<string | null>(null);
  const [draftUrl, setDraftUrl] = useState('');
  const [urlMessage, setUrlMessage] = useState<string | null>(null);
  const [urlBusy, setUrlBusy] = useState(false);
  const [pendingRecreate, setPendingRecreate] = useState<{
    name: string;
    projectId: string;
    service: string;
  } | null>(null);
  const [containers, setContainers] = useState<ContainerSummary[]>([]);
  const [updates, setUpdates] = useState<UpdateCheckResult[]>([]);
  const [updateConfirm, setUpdateConfirm] = useState<string[] | null>(null);
  const [updateBusy, setUpdateBusy] = useState<string | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [containerOrder, setContainerOrder] = useState<string[]>([]);
  const [dragContainer, setDragContainer] = useState<string | null>(null);
  const dragged = useRef(false);
  const [pageHost, setPageHost] = useState('');

  useEffect(() => {
    setOrder(readOrder());
    setWidgets(readWidgets());
    setHint(localStorage.getItem(HINT_KEY) !== '0');
    setPageHost(window.location.hostname);
    setUrlOverrides(readUrlOverrides());
    try {
      const raw = JSON.parse(localStorage.getItem(CONTAINER_ORDER_KEY) ?? '[]') as unknown;
      setContainerOrder(Array.isArray(raw) ? raw.filter((id): id is string => typeof id === 'string') : []);
    } catch {
      setContainerOrder([]);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      if (document.visibilityState === 'hidden') return;
      void Promise.all([
        fetchContainers().catch(() => null),
        fetchUpdates().catch(() => null),
      ]).then(([list, checks]) => {
        if (cancelled) return;
        if (list) setContainers(list);
        if (checks) setUpdates(checks);
      });
    };
    load();
    const timer = window.setInterval(load, 30_000);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') load();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  useEffect(() => {
    if (!editingName) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setEditingName(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editingName]);

  const decoratedContainers = useMemo(
    () => containers.map((container) => withUrlOverride(container, urlOverrides)),
    [containers, urlOverrides],
  );

  const orderedContainers = useMemo(() => {
    const byName = new Map(decoratedContainers.map((container) => [container.name, container]));
    const next: ContainerSummary[] = [];
    for (const name of containerOrder) {
      const container = byName.get(name);
      if (!container) continue;
      next.push(container);
      byName.delete(name);
    }
    const rest = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
    return [...next, ...rest];
  }, [decoratedContainers, containerOrder]);

  const apps = useMemo(
    () =>
      order.flatMap((key) => {
        const app = APPS.find((item) => item.key === key);
        return app ? [{ key, href: app.href }] : [];
      }),
    [order],
  );

  const needle = query.trim().toLowerCase();
  const visibleContainers = needle
    ? orderedContainers.filter(
        (container) =>
          container.name.toLowerCase().includes(needle) || container.image.toLowerCase().includes(needle),
      )
    : orderedContainers;
  const pageHits = needle
    ? APPS.filter((app) => t.nav[app.key].toLowerCase().includes(needle))
    : [];
  const pendingUpdates = useMemo(
    () => updates.filter((item) => item.updateAvailable && !item.error),
    [updates],
  );
  const updateCount = updates.length > 0 ? pendingUpdates.length : overview.updatesAvailable;

  const saveOrder = (next: DockKey[]) => {
    setOrder(next);
    localStorage.setItem(ORDER_KEY, JSON.stringify(next));
  };

  const dropOn = (target: DockKey) => {
    if (!dragKey || dragKey === target) return;
    const next = order.filter((key) => key !== dragKey);
    const index = next.indexOf(target);
    next.splice(index < 0 ? next.length : index, 0, dragKey);
    saveOrder(next);
    setDragKey(null);
  };

  const persistUrl = (name: string, url: string) => {
    const next = { ...urlOverrides, [name]: url };
    setUrlOverrides(next);
    localStorage.setItem(URL_KEY, JSON.stringify(next));
  };

  const saveAppUrl = async (container: ContainerSummary) => {
    const url = draftUrl.trim();
    if (url && !/^https?:\/\//i.test(url)) {
      setUrlMessage(home.appUrlHint);
      return;
    }
    setUrlBusy(true);
    setUrlMessage(null);
    setPendingRecreate(null);
    const service = container.labels['com.docker.compose.service']?.trim();
    const workingDir = container.labels['com.docker.compose.project.working_dir']?.trim();
    const projectName = container.labels['com.docker.compose.project']?.trim() || container.composeProject;
    try {
      if (service) {
        const projects = await fetchComposeProjects();
        const project = projects.find((item) => {
          const path = item.path.replace(/\/+$/, '');
          return (workingDir && path === workingDir.replace(/\/+$/, '')) || item.name === projectName;
        });
        if (!project) {
          persistUrl(container.name, url);
          setUrlMessage(home.appUrlComposeMissing);
          return;
        }
        const details = await fetchComposeProject(project.id);
        const nextYaml = setComposeServiceUrl(details.yaml, service, url);
        await saveComposeYaml(project.id, nextYaml);
        persistUrl(container.name, url);
        setPendingRecreate({ name: container.name, projectId: project.id, service });
        setUrlMessage(home.appUrlSavedRecreate);
      } else {
        persistUrl(container.name, url);
        setUrlMessage(home.appUrlComposeMissing);
      }
    } catch (error) {
      setUrlMessage(error instanceof Error ? error.message : t.common.failed);
    } finally {
      setUrlBusy(false);
    }
  };

  const recreateSavedService = async () => {
    if (!pendingRecreate) return;
    setUrlBusy(true);
    setUrlMessage(null);
    try {
      await composeAction(pendingRecreate.projectId, 'recreate', pendingRecreate.service);
      const list = await fetchContainers();
      setContainers(list);
      setUrlMessage(home.appUrlRecreated);
      setPendingRecreate(null);
    } catch (error) {
      setUrlMessage(error instanceof Error ? error.message : t.common.failed);
    } finally {
      setUrlBusy(false);
    }
  };

  const applyContainerUpdates = async (ids: string[]) => {
    setUpdateError(null);
    setUpdateBusy(ids[0] ?? 'all');
    try {
      for (const id of ids) {
        setUpdateBusy(id);
        const result = await pullUpdate(id);
        if (!result.ok) {
          throw new Error(result.message);
        }
      }
      const [list, checks] = await Promise.all([
        fetchContainers().catch(() => null),
        fetchUpdates().catch(() => null),
      ]);
      if (list) setContainers(list);
      if (checks) setUpdates(checks);
    } catch (error) {
      setUpdateError(error instanceof Error ? error.message : t.common.failed);
    } finally {
      setUpdateBusy(null);
    }
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
    <>
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
            <div className="dockora-glass mt-2 space-y-2 px-4 py-3 text-sm">
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
        <div className="flex flex-wrap items-center gap-3">
          <BrandLogoWide size="sm" priority />
          <div className="relative min-w-[12rem] flex-1">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={home.searchPlaceholder}
              aria-label={home.searchPlaceholder}
              className="dockora-glass w-full rounded-full border-white/10 bg-black/30 px-4 py-3 text-sm outline-none placeholder:text-dockora-muted"
            />
            {pageHits.length > 0 ? (
              <ul className="dockora-glass absolute left-0 right-0 z-30 mt-2 overflow-hidden py-1">
                {pageHits.map((hit) => (
                  <li key={hit.key}>
                    <Link href={hit.href} className="block px-4 py-2 text-sm hover:bg-white/5" onClick={() => setQuery('')}>
                      {t.nav[hit.key]}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
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
            icon={<NAV_ICONS.containers className="h-8 w-8" />}
          />
          <FeatureCard
            href={updateCount > 0 ? '/updates' : '/monitoring'}
            title={t.dashboard.engine}
            body={
              updateCount > 0
                ? home.updatesHint.replace('{count}', String(updateCount))
                : home.engineHint
                    .replace('{status}', engineLabel)
                    .replace('{version}', overview.docker.engineVersion ?? t.dashboard.versionUnknown)
            }
            action={home.open}
            tone="cyan"
            icon={<NAV_ICONS.monitoring className="h-8 w-8" />}
            secondaryLabel={home.more}
            onSecondary={onOpenEngine}
            updateLabel={
              canEdit && pendingUpdates.length > 0
                ? pendingUpdates.length > 1
                  ? t.updates.applyAll
                  : t.updates.pull
                : undefined
            }
            updateBusy={updateBusy !== null}
            onUpdate={
              canEdit && pendingUpdates.length > 0
                ? () => setUpdateConfirm(pendingUpdates.map((item) => item.containerId))
                : undefined
            }
          />
        </div>
        {updateError ? <p className="text-xs text-dockora-danger">{updateError}</p> : null}

        <section aria-label={home.apps} className="relative">
          <div className="mb-3 flex items-center gap-3">
            <h2 className="text-sm font-medium text-dockora-text">{home.apps}</h2>
            {hint ? (
              <p className="flex items-center gap-2 rounded-md bg-black/55 px-2 py-1 text-xs text-white">
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
            <Link
              href="/compose/new"
              className="dockora-glass ml-auto flex h-9 w-9 items-center justify-center text-2xl leading-none text-dockora-muted hover:text-white"
              aria-label={home.add}
            >
              +
            </Link>
          </div>
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-3">
            {visibleContainers.map((container) => {
              const target = resolveContainerAppHref(container, pageHost);
              const icon = resolveContainerIconUrl(container.labels);
              const runningTile = container.status === 'running';
              return (
                <li key={container.id}>
                  <ContainerTile
                    href={target.href}
                    external={target.external}
                    name={container.name}
                    dimmed={!runningTile}
                    dragging={dragContainer === container.name}
                    onPointerDown={(event) => {
                      const startX = event.clientX;
                      const startY = event.clientY;
                      const targetEl = event.currentTarget;
                      const move = (ev: globalThis.PointerEvent) => {
                        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) > 8) {
                          dragged.current = true;
                          targetEl.draggable = true;
                          setDragContainer(container.name);
                        }
                      };
                      const up = () => {
                        window.removeEventListener('pointermove', move);
                        window.removeEventListener('pointerup', up);
                        window.setTimeout(() => {
                          dragged.current = false;
                        }, 0);
                      };
                      window.addEventListener('pointermove', move);
                      window.addEventListener('pointerup', up);
                    }}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={() => {
                      if (!dragContainer || dragContainer === container.name) return;
                      const names = orderedContainers.map((item) => item.name);
                      const next = names.filter((name) => name !== dragContainer);
                      const index = next.indexOf(container.name);
                      next.splice(index < 0 ? next.length : index, 0, dragContainer);
                      setContainerOrder(next);
                      localStorage.setItem(CONTAINER_ORDER_KEY, JSON.stringify(next));
                      setDragContainer(null);
                    }}
                    onDragEnd={(event) => {
                      event.currentTarget.draggable = false;
                      setDragContainer(null);
                    }}
                    onClick={(event) => {
                      if (!dragged.current) return;
                      event.preventDefault();
                      dragged.current = false;
                    }}
                    detailHref={`/containers/${encodeURIComponent(container.id)}`}
                    detailLabel={home.openInDockora}
                    editLabel={home.appUrl}
                    updateLabel={
                      updateBusy === container.id ? t.updates.applying : t.updates.pull
                    }
                    onUpdate={
                      canEdit && pendingUpdates.some((item) => item.containerId === container.id)
                        ? () => setUpdateConfirm([container.id])
                        : undefined
                    }
                    updateBusy={updateBusy !== null}
                    onEdit={
                      canEdit
                        ? () => {
                            if (editingName === container.name) {
                              setEditingName(null);
                              return;
                            }
                            const pending = pendingRecreate?.name === container.name;
                            setEditingName(container.name);
                            setDraftUrl(
                              container.labels.url ||
                                container.labels['dockora.url'] ||
                                container.labels['homepage.href'] ||
                                '',
                            );
                            setPendingRecreate((current) =>
                              current?.name === container.name ? current : null,
                            );
                            setUrlMessage(pending ? home.appUrlSavedRecreate : null);
                          }
                        : undefined
                    }
                    editor={
                      editingName === container.name ? (
                        <form
                          className="mt-2 w-full space-y-2 border-t border-white/10 pt-2 text-left"
                          onSubmit={(event) => {
                            event.preventDefault();
                            void saveAppUrl(container);
                          }}
                          onPointerDown={(event) => event.stopPropagation()}
                        >
                          <label className="block text-[11px] text-dockora-muted">
                            {home.appUrl}
                            <input
                              value={draftUrl}
                              onChange={(event) => setDraftUrl(event.target.value)}
                              placeholder="http://"
                              className="mt-1 w-full rounded-md border border-white/10 bg-black/40 px-2 py-1 text-xs text-dockora-text"
                            />
                          </label>
                          <p className="text-[10px] leading-snug text-dockora-muted">{home.appUrlHint}</p>
                          {urlMessage ? <p className="text-[11px] leading-snug text-dockora-text">{urlMessage}</p> : null}
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="submit"
                              disabled={urlBusy}
                              className="rounded-full bg-dockora-pink px-2 py-1 text-[11px] text-white disabled:opacity-50"
                            >
                              {home.appUrlSave}
                            </button>
                            {pendingRecreate?.name === container.name ? (
                              <button
                                type="button"
                                disabled={urlBusy}
                                onClick={() => void recreateSavedService()}
                                className="rounded-full border border-white/15 px-2 py-1 text-[11px] text-dockora-text disabled:opacity-50"
                              >
                                {urlBusy ? home.appUrlRecreating : home.appUrlRecreate}
                              </button>
                            ) : null}
                            <button
                              type="button"
                              className="rounded-full px-2 py-1 text-[11px] text-dockora-muted hover:text-white"
                              onClick={() => setEditingName(null)}
                            >
                              {t.common.close}
                            </button>
                          </div>
                        </form>
                      ) : null
                    }
                  >
                    <span className="relative">
                      <ServiceIcon
                        url={icon}
                        alt={container.name}
                        className="h-[4.25rem] w-[4.25rem] rounded-[1.15rem] bg-white/[0.06] object-contain p-1.5 text-2xl"
                      />
                      <span
                        className={cn(
                          'absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-[#0d0d15]',
                          runningTile ? 'bg-dockora-success' : 'bg-dockora-muted',
                        )}
                      />
                    </span>
                  </ContainerTile>
                </li>
              );
            })}
          </ul>
        </section>

        <section aria-label={home.suite}>
          <ul className="flex flex-wrap gap-2">
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
                      const move = (ev: globalThis.PointerEvent) => {
                        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) > 8) {
                          dragged.current = true;
                          target.draggable = true;
                          setDragKey(app.key);
                        }
                      };
                      const up = () => {
                        window.removeEventListener('pointermove', move);
                        window.removeEventListener('pointerup', up);
                        window.setTimeout(() => {
                          dragged.current = false;
                        }, 0);
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
                      'dockora-glass flex items-center gap-2 rounded-2xl px-2.5 py-2 text-xs transition-transform hover:-translate-y-0.5',
                      dragKey === app.key && 'opacity-50',
                    )}
                  >
                    <span
                      className={cn(
                        'flex h-8 w-8 items-center justify-center rounded-xl text-white',
                        TILE[app.key],
                      )}
                    >
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="text-dockora-text">{t.nav[app.key]}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      </div>
      <ConfirmDialog
        open={updateConfirm !== null}
        title={updateConfirm && updateConfirm.length > 1 ? t.updates.applyAll : t.updates.pull}
        description={
          updateConfirm && updateConfirm.length > 1
            ? t.updates.applyAllConfirm.replace('{count}', String(updateConfirm.length))
            : t.updates.applyConfirm
        }
        consequences={[
          t.updates.stepPull,
          t.updates.stepRecreate,
          t.updates.stepHealth,
          t.updates.stepRollback,
        ]}
        confirmLabel={t.common.confirm}
        cancelLabel={t.common.cancel}
        busy={updateBusy !== null}
        onCancel={() => setUpdateConfirm(null)}
        onConfirm={() => {
          const ids = updateConfirm;
          setUpdateConfirm(null);
          if (ids && ids.length > 0) void applyContainerUpdates(ids);
        }}
      />
    </div>
    </>
  );
}

function ContainerTile({
  href,
  external,
  name,
  dimmed,
  dragging,
  children,
  detailHref,
  detailLabel,
  editLabel,
  onEdit,
  updateLabel,
  onUpdate,
  updateBusy,
  editor,
  onPointerDown,
  onDragOver,
  onDrop,
  onDragEnd,
  onClick,
}: {
  href: string;
  external: boolean;
  name: string;
  dimmed: boolean;
  dragging: boolean;
  children: ReactNode;
  detailHref: string;
  detailLabel: string;
  editLabel?: string;
  onEdit?: () => void;
  updateLabel?: string;
  onUpdate?: () => void;
  updateBusy?: boolean;
  editor?: ReactNode;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onDragOver: (event: ReactDragEvent<HTMLDivElement>) => void;
  onDrop: () => void;
  onDragEnd: (event: ReactDragEvent<HTMLDivElement>) => void;
  onClick: (event: ReactMouseEvent<HTMLAnchorElement>) => void;
}) {
  const shell = cn(
    'dockora-glass relative flex flex-col items-center px-2 pb-3 transition-transform hover:-translate-y-0.5 hover:border-dockora-pink/45',
    dimmed && 'opacity-50',
    dragging && 'opacity-50',
  );
  const face = 'flex w-full items-center justify-center px-2 pt-3';
  const open = external ? (
    <a href={href} target="_blank" rel="noopener noreferrer" title={name} className={face} onClick={onClick}>
      {children}
    </a>
  ) : (
    <Link href={href} title={name} className={face} onClick={onClick}>
      {children}
    </Link>
  );
  return (
    <div
      className={shell}
      draggable={dragging}
      onPointerDown={onPointerDown}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      onContextMenu={(event) => {
        if (!onEdit) return;
        event.preventDefault();
        onEdit();
      }}
    >
      {open}
      <Link
        href={detailHref}
        title={name}
        aria-label={`${name}. ${detailLabel}`}
        className="mt-2 max-w-full truncate px-1 text-xs text-dockora-text hover:text-dockora-pink"
        onPointerDown={(event) => event.stopPropagation()}
      >
        {name}
      </Link>
      {onUpdate || onEdit ? (
        <div className="mt-1.5 flex flex-wrap items-center justify-center gap-1">
          {onUpdate ? (
            <button
              type="button"
              disabled={updateBusy}
              className="inline-flex rounded-full bg-dockora-pink px-2.5 py-1 text-[11px] text-white disabled:opacity-50"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onUpdate();
              }}
            >
              {updateLabel}
            </button>
          ) : null}
          {onEdit ? (
            <button
              type="button"
              aria-label={editLabel}
              className="inline-flex items-center gap-1 rounded-full border border-white/15 px-2.5 py-1 text-[11px] text-dockora-text hover:border-dockora-pink/50 hover:text-white"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onEdit();
              }}
            >
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                <path d="M4 20h4l10-10-4-4L4 16v4Z" />
                <path d="m12 6 4 4" />
              </svg>
              {editLabel}
            </button>
          ) : null}
        </div>
      ) : null}
      {editor}
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
  icon,
  secondaryLabel,
  onSecondary,
  updateLabel,
  onUpdate,
  updateBusy,
}: {
  href: string;
  title: string;
  body: string;
  action: string;
  tone: 'pink' | 'cyan';
  alert?: string | null;
  icon?: ReactNode;
  secondaryLabel?: string;
  onSecondary?: () => void;
  updateLabel?: string;
  onUpdate?: () => void;
  updateBusy?: boolean;
}) {
  return (
    <div className="dockora-glass relative flex min-h-[8.5rem] items-center justify-between gap-3 overflow-hidden px-5 py-4">
      <div className="relative z-10 min-w-0">
        <h2 className="text-lg font-medium">{title}</h2>
        <p className="mt-1 text-sm text-dockora-muted">{body}</p>
        {alert ? <p className="mt-1 truncate text-xs text-dockora-danger">{alert}</p> : null}
        <div className="mt-4 flex flex-wrap gap-2">
          <Link
            href={href}
            className={cn(
              'inline-flex w-fit rounded-full px-3 py-1 text-xs font-medium text-white',
              tone === 'pink' ? 'bg-dockora-pink' : 'bg-dockora-blue',
            )}
          >
            {action}
          </Link>
          {updateLabel && onUpdate ? (
            <button
              type="button"
              disabled={updateBusy}
              onClick={onUpdate}
              className="inline-flex rounded-full bg-dockora-pink px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
            >
              {updateLabel}
            </button>
          ) : null}
          {secondaryLabel && onSecondary ? (
            <button
              type="button"
              onClick={onSecondary}
              className="inline-flex rounded-full border border-white/15 px-3 py-1 text-xs text-dockora-text"
            >
              {secondaryLabel}
            </button>
          ) : null}
        </div>
      </div>
      {icon ? (
        <span
          className={cn(
            'pointer-events-none flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-white/5',
            tone === 'pink' ? 'text-dockora-pink' : 'text-dockora-blue',
          )}
          aria-hidden
        >
          {icon}
        </span>
      ) : null}
    </div>
  );
}
