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
import { createPortal } from 'react-dom';
import type { ContainerSummary, DashboardOverview, HomeLayout, HomeLink, Locale, UpdateCheckResult } from '@dockora/shared';
import { HOME_DOCK_KEYS } from '@dockora/shared';
import { AuthLogoutButton, useAuth } from '@/components/auth/auth-provider';
import { BrandLogoWide } from '@/components/ui/brand-logo';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Button, buttonClassName } from '@/components/ui/form-controls';
import { NAV_ICONS } from '@/components/ui/nav-icons';
import { ServiceIcon } from '@/components/ui/service-icon';
import { useLocale } from '@/i18n/locale-provider';
import {
  checkUpdates,
  composeAction,
  fetchComposeProject,
  fetchComposeProjects,
  fetchContainers,
  fetchDiscoveredAppUrls,
  fetchHomeLayout,
  fetchSelfUpdateStatus,
  fetchUpdates,
  pullUpdate,
  saveComposeYaml,
  saveHomeLayout,
} from '@/lib/api';
import { pickHomeLayout, readHomeLayoutCache, withDockDefaults, writeHomeLayoutCache } from '@/lib/home-layout';
import { containerLinkChoices, resolveContainerAppHref, resolvePublicAppUrl } from '@/lib/container-app-link';
import { resolveContainerIconUrl } from '@/lib/container-icon';
import { setComposeServicePublicUrl, setComposeServiceUrl } from '@/lib/compose-icon-yaml';
import { formatBytes, formatPercent, formatRelativeTime, usageRatio } from '@/lib/format';
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
const DOCK_KEYS: AppKey[] = [...HOME_DOCK_KEYS];
type DockKey = AppKey;

const HINT_KEY = 'dockora.home.dragHint';

type Widgets = { system: boolean; storage: boolean; network: boolean };

const DEFAULT_WIDGETS: Widgets = { system: true, storage: true, network: true };

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

function linkKey(id: string) {
  return `link:${id}`;
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
  const [publicUrlOverrides, setPublicUrlOverrides] = useState<Record<string, string>>({});
  const [discoveredUrls, setDiscoveredUrls] = useState<Record<string, string>>({});
  const [editingName, setEditingName] = useState<string | null>(null);
  const [draftUrl, setDraftUrl] = useState('');
  const [draftPublicUrl, setDraftPublicUrl] = useState('');
  const [linkPicker, setLinkPicker] = useState<string | null>(null);
  const [urlMessage, setUrlMessage] = useState<string | null>(null);
  const [urlBusy, setUrlBusy] = useState(false);
  const [pendingRecreate, setPendingRecreate] = useState<{
    name: string;
    projectId: string;
    service: string;
  } | null>(null);
  const [containers, setContainers] = useState<ContainerSummary[]>([]);
  const [updates, setUpdates] = useState<UpdateCheckResult[]>([]);
  const [selfUpdate, setSelfUpdate] = useState<Awaited<ReturnType<typeof fetchSelfUpdateStatus>> | null>(null);
  const [updateConfirm, setUpdateConfirm] = useState<string[] | null>(null);
  const [updateBusy, setUpdateBusy] = useState<string | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [layoutError, setLayoutError] = useState<string | null>(null);
  const [containerOrder, setContainerOrder] = useState<string[]>([]);
  const [homeLinks, setHomeLinks] = useState<HomeLink[]>([]);
  const [addEditor, setAddEditor] = useState<null | 'choose' | 'link'>(null);
  const [linkDraft, setLinkDraft] = useState({ name: '', url: '', icon: '' });
  const [linkError, setLinkError] = useState<string | null>(null);
  const [dragContainer, setDragContainer] = useState<string | null>(null);
  const dragged = useRef(false);
  const [pageHost, setPageHost] = useState('');
  const layoutRef = useRef<HomeLayout>(readHomeLayoutCache());
  const dirtyRef = useRef(false);
  const hydratedRef = useRef(false);
  const saveTimer = useRef<number | null>(null);
  const canEditRef = useRef(canEdit);
  canEditRef.current = canEdit;

  const applyLayout = (layout: HomeLayout) => {
    layoutRef.current = layout;
    setOrder(withDockDefaults(layout.appOrder) as DockKey[]);
    setWidgets(layout.widgets);
    setUrlOverrides(layout.appUrls ?? {});
    setPublicUrlOverrides(layout.appPublicUrls ?? {});
    setHomeLinks(layout.links);
    setContainerOrder(layout.containerOrder);
  };

  const publish = (patch: Partial<HomeLayout>) => {
    const next = { ...layoutRef.current, ...patch };
    if (!hydratedRef.current) dirtyRef.current = true;
    applyLayout(next);
    writeHomeLayoutCache(next);
    if (!hydratedRef.current || !canEditRef.current) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      saveTimer.current = null;
      void saveHomeLayout(layoutRef.current).catch(() => setLayoutError(home.layoutSaveFailed));
    }, 400);
  };

  useEffect(() => {
    const local = readHomeLayoutCache();
    applyLayout(local);
    setHint(localStorage.getItem(HINT_KEY) !== '0');
    setPageHost(window.location.hostname);
    let cancelled = false;
    void fetchHomeLayout()
      .then(async (remote) => {
        if (cancelled) return;
        const choice = pickHomeLayout({
          remoteStored: remote.stored,
          remote: remote.layout,
          local: dirtyRef.current ? layoutRef.current : local,
          dirty: dirtyRef.current,
          canEdit,
        });
        applyLayout(choice.layout);
        writeHomeLayoutCache(choice.layout);
        if (choice.upload) {
          await saveHomeLayout(choice.layout).catch(() => {
            if (!cancelled) setLayoutError(home.layoutSaveFailed);
          });
        }
        if (!cancelled) hydratedRef.current = true;
      })
      .catch(() => {
        if (!cancelled) hydratedRef.current = true;
      });
    return () => {
      cancelled = true;
    };
  }, [canEdit, home.layoutSaveFailed]);

  useEffect(() => {
    return () => {
      if (!saveTimer.current) return;
      window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
      if (hydratedRef.current && canEditRef.current) {
        void saveHomeLayout(layoutRef.current).catch(() => undefined);
      }
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      if (document.visibilityState === 'hidden') return;
      void Promise.all([
        fetchContainers().catch(() => null),
        fetchUpdates().catch(() => null),
        fetchDiscoveredAppUrls().catch(() => null),
        fetchSelfUpdateStatus().catch(() => null),
      ]).then(([list, checks, discovered, dockora]) => {
        if (cancelled) return;
        if (list) setContainers(list);
        if (checks) setUpdates(checks);
        if (discovered) setDiscoveredUrls(discovered);
        if (dockora) setSelfUpdate(dockora);
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
    if (!addEditor) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setAddEditor(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [addEditor]);

  useEffect(() => {
    if (!linkPicker) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setLinkPicker(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [linkPicker]);

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

  const gridItems = useMemo(() => {
    const byContainer = new Map(decoratedContainers.map((container) => [container.name, container]));
    const byLink = new Map(homeLinks.map((link) => [linkKey(link.id), link]));
    const next: Array<
      | { key: string; kind: 'container'; container: ContainerSummary }
      | { key: string; kind: 'link'; link: HomeLink }
    > = [];
    const seen = new Set<string>();
    for (const key of containerOrder) {
      const container = byContainer.get(key);
      if (container) {
        next.push({ key, kind: 'container', container });
        seen.add(key);
        continue;
      }
      const link = byLink.get(key);
      if (link) {
        next.push({ key, kind: 'link', link });
        seen.add(key);
      }
    }
    const restContainers = [...byContainer.entries()]
      .filter(([key]) => !seen.has(key))
      .sort((a, b) => a[0].localeCompare(b[0]));
    const restLinks = [...byLink.entries()]
      .filter(([key]) => !seen.has(key))
      .sort((a, b) => a[1].name.localeCompare(b[1].name));
    for (const [key, container] of restContainers) next.push({ key, kind: 'container', container });
    for (const [key, link] of restLinks) next.push({ key, kind: 'link', link });
    return next;
  }, [decoratedContainers, homeLinks, containerOrder]);

  const linkDialog = useMemo(() => {
    if (!linkPicker) return null;
    const container = decoratedContainers.find((item) => item.name === linkPicker);
    if (!container) return null;
    const choices = containerLinkChoices(container, pageHost, publicUrlOverrides, discoveredUrls).map((choice) => ({
      ...choice,
      label: choice.key === 'public' ? home.appUrlPublic : home.appUrlInternal,
    }));
    if (choices.length === 0) return null;
    return { name: container.name, icon: resolveContainerIconUrl(container.labels), choices };
  }, [linkPicker, decoratedContainers, pageHost, publicUrlOverrides, discoveredUrls, home.appUrlInternal, home.appUrlPublic]);

  const apps = useMemo(
    () =>
      order.flatMap((key) => {
        const app = APPS.find((item) => item.key === key);
        return app ? [{ key, href: app.href }] : [];
      }),
    [order],
  );

  const needle = query.trim().toLowerCase();
  const visibleItems = needle
    ? gridItems.filter((item) => {
        if (item.kind === 'link') {
          return (
            item.link.name.toLowerCase().includes(needle) || item.link.url.toLowerCase().includes(needle)
          );
        }
        return (
          item.container.name.toLowerCase().includes(needle) ||
          item.container.image.toLowerCase().includes(needle)
        );
      })
    : gridItems;
  const pageHits = needle
    ? APPS.filter((app) => t.nav[app.key].toLowerCase().includes(needle))
    : [];
  const pendingUpdates = useMemo(
    () => updates.filter((item) => item.updateAvailable && !item.error),
    [updates],
  );
  const updateCount = updates.length > 0 ? pendingUpdates.length : overview.updatesAvailable;
  const checkedAt = useMemo(() => {
    let latest = '';
    for (const item of updates) {
      if (item.checkedAt > latest) latest = item.checkedAt;
    }
    return latest || null;
  }, [updates]);

  const saveOrder = (next: DockKey[]) => {
    publish({ appOrder: next });
  };

  const dropOn = (target: DockKey) => {
    if (!dragKey || dragKey === target) return;
    const next = order.filter((key) => key !== dragKey);
    const index = next.indexOf(target);
    next.splice(index < 0 ? next.length : index, 0, dragKey);
    saveOrder(next);
    setDragKey(null);
  };

  const persistUrls = (name: string, internal: string, publicUrl: string | undefined) => {
    const appPublicUrls = { ...(layoutRef.current.appPublicUrls ?? {}) };
    if (publicUrl !== undefined) appPublicUrls[name] = publicUrl;
    publish({
      appUrls: { ...layoutRef.current.appUrls, [name]: internal },
      appPublicUrls,
    });
  };

  const checkForUpdates = async () => {
    setChecking(true);
    setUpdateError(null);
    try {
      setUpdates(await checkUpdates());
    } catch (error) {
      setUpdateError(error instanceof Error ? error.message : t.common.failed);
    } finally {
      setChecking(false);
    }
  };

  const saveAppUrl = async (container: ContainerSummary) => {
    const url = draftUrl.trim();
    const publicUrl = draftPublicUrl.trim();
    if ((url && !/^https?:\/\//i.test(url)) || (publicUrl && !/^https?:\/\//i.test(publicUrl))) {
      setUrlMessage(home.appUrlHint);
      return;
    }
    const hadPublicOverride = Object.prototype.hasOwnProperty.call(
      layoutRef.current.appPublicUrls ?? {},
      container.name,
    );
    const discoveredPublic = discoveredUrls[container.name] ?? '';
    const publicToStore = publicUrl
      ? publicUrl
      : hadPublicOverride || discoveredPublic
        ? ''
        : undefined;
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
          persistUrls(container.name, url, publicToStore);
          setUrlMessage(home.appUrlComposeMissing);
          return;
        }
        const details = await fetchComposeProject(project.id);
        let nextYaml = setComposeServiceUrl(details.yaml, service, url);
        if (publicToStore !== undefined) {
          nextYaml = setComposeServicePublicUrl(nextYaml, service, publicToStore);
        }
        await saveComposeYaml(project.id, nextYaml);
        persistUrls(container.name, url, publicToStore);
        setPendingRecreate({ name: container.name, projectId: project.id, service });
        setUrlMessage(home.appUrlSavedRecreate);
      } else {
        persistUrls(container.name, url, publicToStore);
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
    publish({ widgets: { ...layoutRef.current.widgets, [key]: value } });
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
            className="dockora-panel flex w-full items-center justify-between px-4 py-3 text-xs font-medium uppercase tracking-wide text-dockora-text"
            onClick={() => setSettingsOpen((open) => !open)}
            aria-expanded={settingsOpen}
          >
            {home.widgetSettings}
            <Chevron />
          </button>
          {settingsOpen ? (
            <div className="dockora-panel mt-2 space-y-2 px-4 py-3 text-sm">
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
          <div className={cn('relative min-w-[12rem] flex-1', pageHits.length > 0 && 'z-30')}>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={home.searchPlaceholder}
              aria-label={home.searchPlaceholder}
              className="dockora-field w-full px-3.5"
            />
            {pageHits.length > 0 ? (
              <ul className="dockora-panel !absolute left-0 right-0 z-30 mt-2 overflow-hidden py-1">
                {pageHits.map((hit) => (
                  <li key={hit.key}>
                    <Link href={hit.href} className="block px-4 py-2 text-sm uppercase tracking-wide hover:bg-dockora-accentSoft" onClick={() => setQuery('')}>
                      {t.nav[hit.key]}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          <select
            aria-label={t.locale.label}
            className="dockora-field dockora-select h-10 shrink-0 px-3 font-mono text-xs"
            value={locale}
            onChange={(e) => setLocale(e.target.value as Locale)}
          >
            <option value="de">DE</option>
            <option value="en">EN</option>
          </select>
          <AuthLogoutButton className="w-auto shrink-0 px-3" />
        </div>
        <div className="dockora-neon-line" />

        {selfUpdate?.updateAvailable ? (
          <div className="dockora-panel flex flex-wrap items-center justify-between gap-3 border-l-[3px] border-l-dockora-pink px-5 py-4">
            <div className="min-w-0">
              <p className="dockora-section-tag">{t.nav.selfUpdate}</p>
              <h2 className="dockora-title-gradient mt-1 text-xl">{home.dockoraUpdate}</h2>
              <p className="mt-1 truncate font-mono text-xs text-dockora-muted">
                {selfUpdate.targetVersion && selfUpdate.targetVersion !== selfUpdate.currentVersion
                  ? home.dockoraUpdateVersion
                      .replace('{current}', selfUpdate.currentVersion)
                      .replace('{next}', selfUpdate.targetVersion)
                  : selfUpdate.currentVersion}
              </p>
            </div>
            <Link href="/self-update" className={buttonClassName({ variant: 'primary', size: 'sm' })}>
              {t.settings.selfUpdate.apply}
            </Link>
          </div>
        ) : null}

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
                ? updateBusy
                  ? home.upgrading
                  : pendingUpdates.length > 1
                    ? home.upgradeAll
                    : home.upgrade
                : undefined
            }
            updateBusy={updateBusy !== null}
            onUpdate={
              canEdit && pendingUpdates.length > 0
                ? () => setUpdateConfirm(pendingUpdates.map((item) => item.containerId))
                : undefined
            }
            footer={
              <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-dockora-muted">
                <span>
                  {home.checkedAt}: {checkedAt ? formatRelativeTime(checkedAt, loc) : home.neverChecked}
                </span>
                {canEdit ? (
                  <button
                    type="button"
                    disabled={checking}
                    onClick={() => void checkForUpdates()}
                    className="font-display text-[10px] font-semibold uppercase tracking-[0.12em] text-dockora-pink hover:text-white disabled:opacity-40"
                  >
                    {checking ? home.checking : home.checkNow}
                  </button>
                ) : null}
              </div>
            }
          />
        </div>
        {updateError ? <p className="text-xs text-dockora-danger">{updateError}</p> : null}
        {layoutError ? <p className="text-xs text-dockora-danger">{layoutError}</p> : null}

        <section aria-label={home.apps} className="relative">
          <div className="mb-3 flex items-center gap-3">
            <h2 className="dockora-section-tag">{home.apps}</h2>
            {hint ? (
              <p className="flex items-center gap-2 text-xs text-dockora-muted">
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
            <div className="ml-auto">
              <button
                type="button"
                className={buttonClassName({ size: 'sm', className: 'w-9 px-0 text-base' })}
                aria-label={home.add}
                aria-expanded={addEditor !== null}
                onClick={() => {
                  setLinkPicker(null);
                  setAddEditor('choose');
                  setLinkError(null);
                }}
              >
                +
              </button>
            </div>
          </div>
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(7.25rem,1fr))] gap-3 sm:grid-cols-[repeat(auto-fill,minmax(9rem,1fr))]">
            {visibleItems.map((item) => {
              if (item.kind === 'link') {
                const { link } = item;
                return (
                  <li key={item.key}>
                    <ContainerTile
                      href={link.url}
                      external
                      name={link.name}
                      dimmed={false}
                      dragging={dragContainer === item.key}
                      detailHref={link.url}
                      detailLabel={link.name}
                      removeLabel={home.linkRemove}
                      onRemove={() => {
                        const nextLinks = homeLinks.filter((entry) => entry.id !== link.id);
                        const nextOrder = containerOrder.filter((key) => key !== item.key);
                        publish({ links: nextLinks, containerOrder: nextOrder });
                      }}
                      onPointerDown={(event) => {
                        const startX = event.clientX;
                        const startY = event.clientY;
                        const targetEl = event.currentTarget;
                        const move = (ev: globalThis.PointerEvent) => {
                          if (Math.hypot(ev.clientX - startX, ev.clientY - startY) > 8) {
                            dragged.current = true;
                            targetEl.draggable = true;
                            setDragContainer(item.key);
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
                        if (!dragContainer || dragContainer === item.key) return;
                        const keys = gridItems.map((entry) => entry.key);
                        const next = keys.filter((key) => key !== dragContainer);
                        const index = next.indexOf(item.key);
                        next.splice(index < 0 ? next.length : index, 0, dragContainer);
                        publish({ containerOrder: next });
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
                    >
                      <ServiceIcon
                        url={link.icon}
                        alt={link.name}
                        className="h-14 w-14 object-contain sm:h-16 sm:w-16"
                      />
                    </ContainerTile>
                  </li>
                );
              }
              const container = item.container;
              const target = resolveContainerAppHref(container, pageHost);
              const publicHref = resolvePublicAppUrl(
                container.name,
                container.labels,
                publicUrlOverrides,
                discoveredUrls,
              );
              const linkChoices = containerLinkChoices(
                container,
                pageHost,
                publicUrlOverrides,
                discoveredUrls,
              ).map((choice) => ({
                ...choice,
                label: choice.key === 'public' ? home.appUrlPublic : home.appUrlInternal,
              }));
              const primary =
                target.external || !publicHref ? target : { href: publicHref, external: true as const };
              const icon = resolveContainerIconUrl(container.labels);
              const runningTile = container.status === 'running';
              return (
                <li key={container.id}>
                  <ContainerTile
                    href={primary.href}
                    external={primary.external}
                    name={container.name}
                    linkChoices={linkChoices}
                    linksOpen={linkPicker === container.name}
                    linksLabel={home.chooseLink}
                    onToggleLinks={() =>
                      setLinkPicker((current) => (current === container.name ? null : container.name))
                    }
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
                      const keys = gridItems.map((entry) => entry.key);
                      const next = keys.filter((key) => key !== dragContainer);
                      const index = next.indexOf(container.name);
                      next.splice(index < 0 ? next.length : index, 0, dragContainer);
                      publish({ containerOrder: next });
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
                      updateBusy === container.id ? home.upgrading : home.upgrade
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
                            setLinkPicker(null);
                            setEditingName(container.name);
                            setDraftUrl(target.external ? target.href : '');
                            setDraftPublicUrl(publicHref ?? '');
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
                            {home.appUrlInternal}
                            <input
                              value={draftUrl}
                              onChange={(event) => setDraftUrl(event.target.value)}
                              placeholder="http://"
                              className="dockora-field mt-1 h-8 w-full px-2 text-xs"
                            />
                          </label>
                          <label className="block text-[11px] text-dockora-muted">
                            {home.appUrlPublic}
                            <input
                              value={draftPublicUrl}
                              onChange={(event) => setDraftPublicUrl(event.target.value)}
                              placeholder="https://"
                              className="dockora-field mt-1 h-8 w-full px-2 text-xs"
                            />
                          </label>
                          <p className="text-[10px] leading-snug text-dockora-muted">{home.appUrlHint}</p>
                          <p className="text-[10px] leading-snug text-dockora-muted">{home.appUrlPublicHint}</p>
                          {urlMessage ? <p className="text-[11px] leading-snug text-dockora-text">{urlMessage}</p> : null}
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="submit"
                              disabled={urlBusy}
                              className={buttonClassName({ variant: 'primary', size: 'sm' })}
                            >
                              {home.appUrlSave}
                            </button>
                            {pendingRecreate?.name === container.name ? (
                              <button
                                type="button"
                                disabled={urlBusy}
                                onClick={() => void recreateSavedService()}
                                className={buttonClassName({ size: 'sm' })}
                              >
                                {urlBusy ? home.appUrlRecreating : home.appUrlRecreate}
                              </button>
                            ) : null}
                            <button
                              type="button"
                              className={buttonClassName({ variant: 'ghost', size: 'sm' })}
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
                        className="h-14 w-14 object-contain sm:h-16 sm:w-16"
                      />
                      <span
                        className={cn(
                          'absolute right-0.5 top-0.5 h-2 w-2 rounded-full ring-2 ring-dockora-surface',
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
          <h2 className="dockora-section-tag mb-3">{home.suite}</h2>
          <ul className="dockora-panel flex gap-0.5 overflow-x-auto p-1.5 md:flex-wrap md:overflow-visible">
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
                    title={t.nav[app.key]}
                    className={cn(
                      'flex shrink-0 items-center gap-2 px-2.5 py-2 text-[11px] font-medium uppercase tracking-wide text-dockora-muted hover:bg-dockora-accentSoft hover:text-white',
                      dragKey === app.key && 'opacity-50',
                    )}
                  >
                    <span className="flex h-7 w-7 items-center justify-center text-dockora-pink">
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="hidden text-inherit sm:inline">{t.nav[app.key]}</span>
                    {app.key === 'selfUpdate' && selfUpdate?.updateAvailable ? (
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-dockora-pink" aria-hidden />
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      </div>
      {addEditor
        ? createPortal(
            <div
              className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
              role="presentation"
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) setAddEditor(null);
              }}
            >
              <div
                role="dialog"
                aria-modal="true"
                aria-label={home.add}
                className="dockora-panel w-full max-w-lg overflow-hidden"
              >
                <div className="flex items-start gap-3 px-5 pt-5">
                  <div className="min-w-0 flex-1">
                    <p className="dockora-section-tag">{home.apps}</p>
                    <h2 className="dockora-title-gradient text-3xl tracking-tight">
                      {addEditor === 'link' ? home.addLink : home.add}
                    </h2>
                  </div>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setAddEditor(null)}>
                    {t.common.close}
                  </Button>
                </div>
                <div className="dockora-neon-line mx-5 mt-4" />
                {addEditor === 'choose' ? (
                  <ul>
                    <li className="border-t border-dockora-border/70">
                      <Link
                        href="/compose/new"
                        className="block px-5 py-3 text-sm uppercase tracking-wide hover:bg-white/[0.03]"
                        onClick={() => setAddEditor(null)}
                      >
                        {home.addStack}
                      </Link>
                    </li>
                    <li className="border-t border-dockora-border/70">
                      <button
                        type="button"
                        className="block w-full px-5 py-3 text-left text-sm uppercase tracking-wide hover:bg-white/[0.03]"
                        onClick={() => {
                          setLinkError(null);
                          setAddEditor('link');
                        }}
                      >
                        {home.addLink}
                      </button>
                    </li>
                  </ul>
                ) : (
                  <form
                    className="space-y-3 px-5 py-4"
                    onSubmit={(event) => {
                      event.preventDefault();
                      const name = linkDraft.name.trim();
                      const url = linkDraft.url.trim();
                      const icon = linkDraft.icon.trim();
                      if (!name || !/^https?:\/\//i.test(url) || !/^https?:\/\//i.test(icon)) {
                        setLinkError(home.linkInvalid);
                        return;
                      }
                      const link = {
                        id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
                        name,
                        url,
                        icon,
                      };
                      publish({
                        links: [...homeLinks, link],
                        containerOrder: [...containerOrder, linkKey(link.id)],
                      });
                      setLinkDraft({ name: '', url: '', icon: '' });
                      setLinkError(null);
                      setAddEditor(null);
                    }}
                  >
                    <label className="block text-xs font-medium uppercase tracking-wide text-dockora-muted">
                      {home.linkName}
                      <input
                        value={linkDraft.name}
                        onChange={(event) => setLinkDraft((draft) => ({ ...draft, name: event.target.value }))}
                        className="dockora-field mt-1 w-full px-3"
                      />
                    </label>
                    <label className="block text-xs font-medium uppercase tracking-wide text-dockora-muted">
                      {home.linkUrl}
                      <input
                        value={linkDraft.url}
                        onChange={(event) => setLinkDraft((draft) => ({ ...draft, url: event.target.value }))}
                        placeholder="https://"
                        className="dockora-field mt-1 w-full px-3"
                      />
                    </label>
                    <label className="block text-xs font-medium uppercase tracking-wide text-dockora-muted">
                      {home.linkIcon}
                      <input
                        value={linkDraft.icon}
                        onChange={(event) => setLinkDraft((draft) => ({ ...draft, icon: event.target.value }))}
                        placeholder="https://"
                        className="dockora-field mt-1 w-full px-3"
                      />
                    </label>
                    {linkError ? <p className="text-xs text-dockora-danger">{linkError}</p> : null}
                    <div className="flex flex-wrap justify-end gap-2 pt-1">
                      <button
                        type="button"
                        className={buttonClassName({ variant: 'ghost', size: 'sm' })}
                        onClick={() => {
                          setLinkError(null);
                          setAddEditor('choose');
                        }}
                      >
                        {t.common.back}
                      </button>
                      <button type="submit" className={buttonClassName({ variant: 'primary', size: 'sm' })}>
                        {home.linkSave}
                      </button>
                    </div>
                  </form>
                )}
              </div>
            </div>,
            document.body,
          )
        : null}
      {linkDialog
        ? createPortal(
            <div
              className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
              role="presentation"
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) setLinkPicker(null);
              }}
            >
              <div
                role="dialog"
                aria-modal="true"
                aria-label={home.chooseLink}
                className="dockora-panel w-full max-w-lg overflow-hidden"
              >
                <div className="flex items-start gap-3 px-5 pt-5">
                  <ServiceIcon
                    url={linkDialog.icon}
                    alt=""
                    className="h-11 w-11 border border-dockora-border bg-black/40 object-contain p-1"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="dockora-section-tag">{home.chooseLink}</p>
                    <h2 className="dockora-title-gradient truncate text-3xl tracking-tight">{linkDialog.name}</h2>
                  </div>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setLinkPicker(null)}>
                    {t.common.close}
                  </Button>
                </div>
                <div className="dockora-neon-line mx-5 mt-4" />
                <ul>
                  {linkDialog.choices.map((choice) => (
                    <li key={choice.key} className="border-t border-dockora-border/70">
                      <a
                        href={choice.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-white/[0.03]"
                        onClick={() => setLinkPicker(null)}
                      >
                        <LinkChoiceIcon kind={choice.key} />
                        <span className="min-w-0 flex-1">
                          <span className="block text-xs font-medium uppercase tracking-wide text-dockora-muted">
                            {choice.label}
                          </span>
                          <span className="block truncate font-mono text-sm text-dockora-text">{choice.href}</span>
                        </span>
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            </div>,
            document.body,
          )
        : null}
      <ConfirmDialog
        open={updateConfirm !== null}
        title={updateConfirm && updateConfirm.length > 1 ? home.upgradeAll : home.upgrade}
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

function LinkChoiceIcon({ kind }: { kind: string }) {
  const publicLink = kind === 'public';
  return (
    <span
      className={cn(
        'flex h-8 w-8 shrink-0 items-center justify-center text-white',
        publicLink
          ? 'bg-gradient-to-br from-dockora-blue to-dockora-purple'
          : 'bg-gradient-to-br from-dockora-pink to-dockora-purple',
      )}
      aria-hidden
    >
      {publicLink ? (
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18M12 3c2.5 2.8 3.8 5.8 3.8 9s-1.3 6.2-3.8 9c-2.5-2.8-3.8-5.8-3.8-9s1.3-6.2 3.8-9Z" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M4 11.5 12 4l8 7.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1v-8.5Z" />
        </svg>
      )}
    </span>
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
  linkChoices,
  linksOpen,
  linksLabel,
  onToggleLinks,
  publicHref,
  publicLabel,
  removeLabel,
  onRemove,
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
  linkChoices?: { key: string; label: string; href: string }[];
  linksOpen?: boolean;
  linksLabel?: string;
  onToggleLinks?: () => void;
  publicHref?: string;
  publicLabel?: string;
  removeLabel?: string;
  onRemove?: () => void;
  updateLabel?: string;
  onUpdate?: () => void;
  updateBusy?: boolean;
  editor?: ReactNode;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onDragOver: (event: ReactDragEvent<HTMLDivElement>) => void;
  onDrop: () => void;
  onDragEnd: (event: ReactDragEvent<HTMLDivElement>) => void;
  onClick: (event: ReactMouseEvent<HTMLElement>) => void;
}) {
  const shell = cn(
    'dockora-panel relative flex flex-col items-center px-2 pb-3',
    dimmed && 'opacity-50',
    dragging && 'opacity-50',
  );
  const face = 'flex w-full items-center justify-center px-2 pt-3';
  const open =
    linkChoices && linkChoices.length > 0 && onToggleLinks ? (
      <button
        type="button"
        title={name}
        aria-label={`${name}. ${linksLabel ?? name}`}
        aria-expanded={linksOpen}
        className={face}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          onClick(event);
          if (event.defaultPrevented) return;
          onToggleLinks();
        }}
      >
        {children}
      </button>
    ) : external ? (
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
      {detailHref.startsWith('http') ? (
        <a
          href={detailHref}
          target="_blank"
          rel="noopener noreferrer"
          title={name}
          className="mt-2 max-w-full truncate px-2 text-center text-sm text-dockora-text hover:text-dockora-pink"
          onPointerDown={(event) => event.stopPropagation()}
        >
          {name}
        </a>
      ) : (
        <Link
          href={detailHref}
          title={name}
          aria-label={`${name}. ${detailLabel}`}
          className="mt-2 max-w-full truncate px-2 text-center text-sm text-dockora-text hover:text-dockora-pink"
          onPointerDown={(event) => event.stopPropagation()}
        >
          {name}
        </Link>
      )}
      {onUpdate || onEdit || onRemove || publicHref ? (
        <div className="mt-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-t border-dockora-border/70 px-2 pt-2">
          {onUpdate ? (
            <button
              type="button"
              disabled={updateBusy}
              className={buttonClassName({ variant: 'primary', size: 'sm' })}
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
          {publicHref && publicLabel ? (
            <a
              href={publicHref}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10px] font-semibold uppercase tracking-[0.12em] text-dockora-muted hover:text-dockora-pink"
              onPointerDown={(event) => event.stopPropagation()}
            >
              {publicLabel}
            </a>
          ) : null}
          {onEdit ? (
            <button
              type="button"
              aria-label={editLabel}
              className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-dockora-muted hover:text-dockora-pink"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onEdit();
              }}
            >
              <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                <path d="M4 20h4l10-10-4-4L4 16v4Z" />
                <path d="m12 6 4 4" />
              </svg>
              {editLabel}
            </button>
          ) : null}
          {onRemove ? (
            <button
              type="button"
              className="text-[10px] font-semibold uppercase tracking-[0.12em] text-dockora-muted hover:text-dockora-danger"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onRemove();
              }}
            >
              {removeLabel}
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
    <section className="dockora-panel px-5 py-4">
      <p className="dockora-title-gradient text-4xl tracking-wide">
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
    <section className="dockora-panel px-5 py-4">
      <CardTitle href="/monitoring">{title}</CardTitle>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Gauge label="CPU" value={overview.resources.cpuPercent} locale={locale} tone="pink" />
        <Gauge label="RAM" value={mem} locale={locale} tone="cyan" />
      </div>
      <p className="mt-3 font-mono text-xs text-dockora-muted">
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
    <section className="dockora-panel px-5 py-4">
      <CardTitle href="/monitoring">{labels.storage}</CardTitle>
      <p className="mt-3 text-xs font-medium uppercase tracking-wide text-dockora-muted">{diskLabel}</p>
      <p className={cn('mt-1 text-3xl leading-none', healthy ? 'dockora-stat-gradient' : 'text-dockora-warning')}>
        {formatPercent(ratio, locale)}
      </p>
      <div className="mt-2 h-1 bg-white/10">
        <div
          className="h-full bg-gradient-to-r from-dockora-pink to-dockora-purple"
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
    <section className="dockora-panel px-5 py-4">
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
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-dockora-muted">{label}</p>
      <p className="dockora-stat-gradient mt-1 whitespace-nowrap text-2xl leading-none">{formatPercent(value, locale)}</p>
      <div className="mt-2 h-1 bg-white/10">
        <div
          className={cn(
            'h-full bg-gradient-to-r from-dockora-pink',
            tone === 'pink' ? 'to-dockora-purple' : 'to-dockora-blue',
          )}
          style={{ width: `${Math.max(2, pct)}%` }}
        />
      </div>
    </div>
  );
}

function CardTitle({ href, children }: { href: string; children: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <h2 className="dockora-section-tag">{children}</h2>
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
  footer,
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
  footer?: ReactNode;
}) {
  return (
    <div className="dockora-panel relative flex min-h-[8.5rem] items-center justify-between gap-3 px-5 py-4">
      <div className="relative z-10 min-w-0">
        <h2 className="dockora-title-gradient text-xl">{title}</h2>
        <p className="mt-1 text-sm text-dockora-muted">{body}</p>
        {alert ? <p className="mt-1 truncate text-xs text-dockora-danger">{alert}</p> : null}
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href={href} className={buttonClassName({ variant: 'primary', size: 'sm' })}>
            {action}
          </Link>
          {updateLabel && onUpdate ? (
            <button
              type="button"
              disabled={updateBusy}
              onClick={onUpdate}
              className={buttonClassName({ variant: 'primary', size: 'sm' })}
            >
              {updateLabel}
            </button>
          ) : null}
          {secondaryLabel && onSecondary ? (
            <button type="button" onClick={onSecondary} className={buttonClassName({ size: 'sm' })}>
              {secondaryLabel}
            </button>
          ) : null}
        </div>
        {footer}
      </div>
      {icon ? (
        <span
          className={cn(
            'pointer-events-none flex h-11 w-11 shrink-0 items-center justify-center',
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
