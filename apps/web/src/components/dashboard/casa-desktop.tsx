'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import type {
  ContainerSummary,
  DashboardOverview,
  HomeDepartment,
  HomeLayout,
  HomeLink,
  Locale,
  UpdateCheckResult,
} from '@dockora/shared';
import { HOME_DOCK_KEYS } from '@dockora/shared';
import { AuthLogoutButton, useAuth } from '@/components/auth/auth-provider';
import { BrandLogoWide } from '@/components/ui/brand-logo';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DialogFrame } from '@/components/ui/focus-dialog';
import { Button, buttonClassName } from '@/components/ui/form-controls';
import { NAV_ICONS } from '@/components/ui/nav-icons';
import { ServiceIcon } from '@/components/ui/service-icon';
import { useLocale } from '@/i18n/locale-provider';
import { useDockerLiveReload } from '@/hooks/use-docker-live-reload';
import {
  checkUpdates,
  composeAction,
  fetchComposeProject,
  fetchComposeProjects,
  fetchContainers,
  fetchDiscoveredAppUrls,
  fetchHomeLayout,
  fetchSelfUpdateStatus,
  ApiError,
  fetchUpdates,
  pullUpdate,
  saveComposeYaml,
  saveHomeLayout,
} from '@/lib/api';
import {
  clampDepartmentBox,
  completeHomeLayout,
  departmentPixelSpan,
  departmentUsesFraction,
  departmentVisualBox,
  fitDepartmentLayout,
  nudgeDepartmentBox,
  pickHomeLayout,
  readHomeLayoutCache,
  withDockDefaults,
  writeHomeLayoutCache,
} from '@/lib/home-layout';
import { createLayoutSaveQueue } from '@/lib/home-layout-save';
import { contentHash } from '@/lib/content-hash';
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

function departmentFrameStyle(
  section: { x: number; y: number; width: number; height: number },
  canvasWidth: number,
  pixelSpan: number,
): { left: number | string; top: number; width: number | string; height: number } {
  if (departmentUsesFraction(section)) {
    return {
      left: `${section.x * 100}%`,
      top: section.y,
      width: `${section.width * 100}%`,
      height: section.height,
    };
  }
  if (canvasWidth <= 0) {
    return { left: 0, top: section.y, width: '100%', height: section.height };
  }
  const visual = departmentVisualBox(section, canvasWidth, pixelSpan);
  return { left: visual.x, top: visual.y, width: visual.width, height: visual.height };
}

export function CasaDesktop({
  overview,
  onOpenEngine,
}: {
  overview: DashboardOverview;
  onOpenEngine: () => void;
}) {
  const router = useRouter();
  const { t, locale, setLocale } = useLocale();
  const { authEnabled, user } = useAuth();
  const canEdit = canOperate(user?.role, authEnabled);
  const loc = locale === 'de' ? 'de-DE' : 'en-US';
  const home = t.dashboard.home;
  const [order, setOrder] = useState<DockKey[]>(() => [...DOCK_KEYS]);
  const orderRef = useRef(order);
  orderRef.current = order;
  const [widgets, setWidgets] = useState<Widgets>(DEFAULT_WIDGETS);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [hint, setHint] = useState(true);
  const [dragKey, setDragKey] = useState<DockKey | null>(null);
  const [dockOver, setDockOver] = useState<DockKey | null>(null);
  const [query, setQuery] = useState('');
  const [hitIndex, setHitIndex] = useState(0);
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
  const [departments, setDepartments] = useState<HomeDepartment[]>([]);
  const [appDepartments, setAppDepartments] = useState<Record<string, string>>({});
  const [departmentDraft, setDepartmentDraft] = useState('');
  const [raisedDepartment, setRaisedDepartment] = useState<string | null>(null);
  const [canvasWidth, setCanvasWidth] = useState(0);
  const [contentHeights, setContentHeights] = useState<Record<string, number>>({});
  const appsSectionRef = useRef<HTMLElement>(null);
  const departmentCanvasRef = useRef<HTMLDivElement>(null);
  const canvasWidthRef = useRef(0);
  canvasWidthRef.current = canvasWidth;

  useEffect(() => {
    const node = appsSectionRef.current;
    if (!node) return;
    const measure = () => {
      const width = node.clientWidth;
      canvasWidthRef.current = width;
      setCanvasWidth((current) => (current === width ? current : width));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [addEditor, setAddEditor] = useState<null | 'choose' | 'link' | 'department'>(null);
  const [linkDraft, setLinkDraft] = useState({ name: '', url: '', icon: '' });
  const [linkError, setLinkError] = useState<string | null>(null);
  const [dragContainer, setDragContainer] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [dropDepartment, setDropDepartment] = useState<string | null>(null);
  const [dragPoint, setDragPoint] = useState<{ x: number; y: number } | null>(null);
  const dragged = useRef(false);
  const [pageHost, setPageHost] = useState('');
  const layoutRef = useRef<HomeLayout>(readHomeLayoutCache());
  const dirtyRef = useRef(false);
  const layoutEpoch = useRef(0);
  const saveGeneration = useRef(0);
  const hydratedRef = useRef(false);
  const saveTimer = useRef<number | null>(null);
  const canEditRef = useRef(canEdit);
  canEditRef.current = canEdit;
  const saveErrorRef = useRef({ failed: home.layoutSaveFailed, conflict: home.layoutSaveConflict });
  saveErrorRef.current = { failed: home.layoutSaveFailed, conflict: home.layoutSaveConflict };
  const saveQueueRef = useRef<ReturnType<typeof createLayoutSaveQueue> | null>(null);
  if (saveQueueRef.current === null) {
    saveQueueRef.current = createLayoutSaveQueue({
      save: async (layout, revision) => (await saveHomeLayout(layout, revision)).revision,
      reloadState: async () => {
        const state = await fetchHomeLayout();
        return { layout: state.layout, revision: state.revision ?? 0 };
      },
      isConflict: (error) => error instanceof ApiError && error.status === 409,
      onError: (kind) =>
        setLayoutError(kind === 'conflict' ? saveErrorRef.current.conflict : saveErrorRef.current.failed),
      onReloaded: (layout) => {
        applyLayout(layout);
        writeHomeLayoutCache(layout);
        dirtyRef.current = false;
      },
      onSaved: () => {
        saveGeneration.current += 1;
        if (saveTimer.current) return;
        dirtyRef.current = false;
      },
    });
  }

  const applyLayout = (layout: HomeLayout) => {
    layoutRef.current = layout;
    setOrder(withDockDefaults(layout.appOrder) as DockKey[]);
    setWidgets(layout.widgets);
    setUrlOverrides(layout.appUrls ?? {});
    setPublicUrlOverrides(layout.appPublicUrls ?? {});
    setHomeLinks(layout.links ?? []);
    setContainerOrder(layout.containerOrder ?? []);
    setDepartments(layout.departments ?? []);
    setAppDepartments(layout.appDepartments ?? {});
  };

  const publish = (patch: Partial<HomeLayout>) => {
    const next = { ...layoutRef.current, ...patch };
    layoutEpoch.current += 1;
    dirtyRef.current = true;
    applyLayout(next);
    writeHomeLayoutCache(next);
    if (!hydratedRef.current || !canEditRef.current) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      saveTimer.current = null;
      saveQueueRef.current?.submit(layoutRef.current);
    }, 400);
  };

  useEffect(() => {
    const local = readHomeLayoutCache();
    applyLayout(local);
    setHint(localStorage.getItem(HINT_KEY) !== '0');
    setPageHost(window.location.hostname);
    let cancelled = false;
    const epoch = layoutEpoch.current;
    const savesAtStart = saveGeneration.current;
    void fetchHomeLayout()
      .then((remote) => {
        if (cancelled) return;
        if (saveGeneration.current !== savesAtStart) {
          hydratedRef.current = true;
          return;
        }
        if (epoch !== layoutEpoch.current) {
          hydratedRef.current = true;
          if (dirtyRef.current && canEditRef.current) {
            saveQueueRef.current?.submit(layoutRef.current);
          }
          return;
        }
        const choice = pickHomeLayout({
          remoteStored: remote.stored,
          remote: completeHomeLayout(remote.layout),
          local: completeHomeLayout(dirtyRef.current ? layoutRef.current : local),
          dirty: dirtyRef.current,
          canEdit,
        });
        applyLayout(choice.layout);
        writeHomeLayoutCache(choice.layout);
        saveQueueRef.current?.setRevision(typeof remote.revision === 'number' ? remote.revision : 0);
        if (choice.upload) saveQueueRef.current?.submit(choice.layout);
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
        saveQueueRef.current?.submit(layoutRef.current);
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
      ]).then(([list, checks]) => {
        if (cancelled) return;
        if (list) setContainers(list);
        if (checks) setUpdates(checks);
      });
    };
    load();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') load();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  useDockerLiveReload(() => {
    if (document.visibilityState === 'hidden') return;
    void fetchContainers()
      .then((list) => setContainers(list))
      .catch(() => undefined);
    void fetchUpdates()
      .then((checks) => setUpdates(checks))
      .catch(() => undefined);
  }, 90_000);

  useEffect(() => {
    let cancelled = false;
    const loadSlow = () => {
      if (document.visibilityState === 'hidden') return;
      void Promise.all([
        canEdit ? fetchDiscoveredAppUrls().catch(() => null) : Promise.resolve(null),
        fetchSelfUpdateStatus().catch(() => null),
      ]).then(([discovered, dockora]) => {
        if (cancelled) return;
        if (discovered) setDiscoveredUrls(discovered);
        if (dockora) setSelfUpdate(dockora);
      });
    };
    loadSlow();
    const timer = window.setInterval(loadSlow, 5 * 60_000);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') loadSlow();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [canEdit]);

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
  const dragLabel = (() => {
    const entry = gridItems.find((item) => item.key === dragContainer);
    if (!entry) return dragContainer ?? '';
    return entry.kind === 'link' ? entry.link.name : entry.container.name;
  })();
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
  const knownDepartments = new Set(departments.map((item) => item.id));
  const looseItems = visibleItems.filter((item) => {
    const dept = appDepartments[item.key];
    return !dept || !knownDepartments.has(dept);
  });
  const departmentSections = departments
    .map((dept) => ({
      ...dept,
      items: visibleItems.filter((item) => appDepartments[item.key] === dept.id),
    }))
    .filter((section) => !needle || section.items.length > 0);
  const departmentMeasureKey = departmentSections.map((section) => `${section.id}:${section.items.length}`).join('|');
  const departmentSpan = departmentPixelSpan(departments);
  const fittedDepartments = fitDepartmentLayout(
    departmentSections.map((section) => ({
      id: section.id,
      ...departmentVisualBox(section, canvasWidth, departmentSpan),
    })),
    contentHeights,
  );

  useEffect(() => {
    const canvas = departmentCanvasRef.current;
    if (!canvas) return;
    const measure = () => {
      const next: Record<string, number> = {};
      for (const node of canvas.querySelectorAll<HTMLElement>(':scope > [data-department-drop]')) {
        const id = node.getAttribute('data-department-drop');
        if (!id) continue;
        next[id] = node.offsetHeight;
      }
      setContentHeights((current) => {
        const ids = Object.keys(next);
        const same =
          ids.length === Object.keys(current).length &&
          ids.every((id) => Math.abs((current[id] ?? 0) - (next[id] ?? 0)) < 2);
        return same ? current : next;
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(canvas);
    for (const node of canvas.querySelectorAll(':scope > [data-department-drop]')) observer.observe(node);
    return () => observer.disconnect();
  }, [departmentMeasureKey, canvasWidth]);

  const pageHits = needle
    ? APPS.filter((app) => t.nav[app.key].toLowerCase().includes(needle))
    : [];
  const activeHit = pageHits[hitIndex] ?? pageHits[0];
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

  const gridKeysRef = useRef<string[]>([]);
  gridKeysRef.current = gridItems.map((entry) => entry.key);
  const appDepartmentsRef = useRef(appDepartments);
  appDepartmentsRef.current = appDepartments;
  const renameSkip = useRef(false);

  const placeApp = (from: string, to: string) => {
    const keys = gridKeysRef.current;
    const fromIndex = keys.indexOf(from);
    const toIndex = keys.indexOf(to);
    if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return;
    const next = [...keys];
    next.splice(fromIndex, 1);
    next.splice(toIndex, 0, from);
    const targetDept = appDepartmentsRef.current[to];
    const map = { ...appDepartmentsRef.current };
    if (targetDept) map[from] = targetDept;
    else delete map[from];
    publish({ containerOrder: next, appDepartments: map });
  };

  const assignDepartment = (appKey: string, departmentId: string) => {
    const map = { ...appDepartmentsRef.current };
    const current = map[appKey];
    const keys = [...gridKeysRef.current];
    const fromIndex = keys.indexOf(appKey);
    if (departmentId === 'loose') {
      if (!current) return;
      delete map[appKey];
      publish({ appDepartments: map });
      return;
    }
    if (current === departmentId) return;
    map[appKey] = departmentId;
    if (fromIndex >= 0) {
      keys.splice(fromIndex, 1);
      let insertAt = keys.length;
      for (let index = keys.length - 1; index >= 0; index -= 1) {
        if (map[keys[index] ?? ''] === departmentId) {
          insertAt = index + 1;
          break;
        }
      }
      keys.splice(insertAt, 0, appKey);
    }
    publish({ containerOrder: keys, appDepartments: map });
  };

  const startAppDrag = (key: string, event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    const startX = event.clientX;
    const startY = event.clientY;
    let active = false;
    let current: { kind: 'tile'; key: string } | { kind: 'department'; id: string } | null = null;
    const blockSelect = (ev: Event) => ev.preventDefault();
    const aimKey = (aim: typeof current) =>
      aim?.kind === 'tile' ? `t:${aim.key}` : aim?.kind === 'department' ? `d:${aim.id}` : '';
    const aim = (x: number, y: number) => {
      const hit = document.elementFromPoint(x, y);
      if (!(hit instanceof Element)) {
        current = null;
        return;
      }
      const tile = hit.closest('[data-app-key]')?.getAttribute('data-app-key') ?? null;
      if (tile && tile !== key) {
        current = { kind: 'tile', key: tile };
        return;
      }
      const zone = hit.closest('[data-department-drop]')?.getAttribute('data-department-drop');
      if (zone) {
        current = { kind: 'department', id: zone };
        return;
      }
      const grid = document.querySelector('[data-app-grid]');
      if (!grid?.contains(hit)) current = null;
    };
    const move = (ev: PointerEvent) => {
      if (!active) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) <= 8) return;
        active = true;
        dragged.current = true;
        setDragContainer(key);
        window.getSelection()?.removeAllRanges();
      }
      ev.preventDefault();
      setDragPoint({ x: ev.clientX, y: ev.clientY });
      const previous = aimKey(current);
      aim(ev.clientX, ev.clientY);
      if (aimKey(current) === previous) return;
      setDropTarget(current?.kind === 'tile' ? current.key : null);
      setDropDepartment(current?.kind === 'department' ? current.id : null);
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      document.removeEventListener('selectstart', blockSelect);
      document.body.style.userSelect = '';
      window.getSelection()?.removeAllRanges();
      if (active && current?.kind === 'tile') placeApp(key, current.key);
      if (active && current?.kind === 'department') assignDepartment(key, current.id);
      setDragContainer(null);
      setDropTarget(null);
      setDropDepartment(null);
      setDragPoint(null);
      window.setTimeout(() => {
        dragged.current = false;
      }, 0);
      ev.preventDefault();
    };
    document.body.style.userSelect = 'none';
    document.addEventListener('selectstart', blockSelect);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  const departmentCanvasWidth = () =>
    canvasWidthRef.current || departmentCanvasRef.current?.clientWidth || appsSectionRef.current?.clientWidth || 1;

  const applyDepartmentBox = (id: string, box: Pick<HomeDepartment, 'x' | 'y' | 'width' | 'height'>) => {
    const current = layoutRef.current.departments.find((item) => item.id === id);
    if (!current) return;
    const next = { ...current, ...box };
    if (next.x === current.x && next.y === current.y && next.width === current.width && next.height === current.height) {
      return;
    }
    publish({
      departments: layoutRef.current.departments.map((item) => (item.id === id ? next : item)),
    });
  };

  const updateDepartmentBox = (id: string, visual: Pick<HomeDepartment, 'x' | 'y' | 'width' | 'height'>) => {
    applyDepartmentBox(id, clampDepartmentBox(visual, departmentCanvasWidth()));
  };

  const nudgeDepartment = (
    id: string,
    delta: Partial<Pick<HomeDepartment, 'x' | 'y' | 'width' | 'height'>>,
  ) => {
    const current = layoutRef.current.departments.find((item) => item.id === id);
    if (!current || !canEditRef.current) return;
    applyDepartmentBox(
      id,
      nudgeDepartmentBox(current, departmentCanvasWidth(), departmentPixelSpan(layoutRef.current.departments), delta),
    );
  };

  const onDepartmentKey = (
    id: string,
    mode: 'move' | 'both' | 'width' | 'height',
    event: ReactKeyboardEvent<HTMLElement>,
  ) => {
    if (!canEditRef.current) return;
    if (event.target !== event.currentTarget) return;
    const step = 8;
    const horizontal = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
    const vertical = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
    if (!horizontal && !vertical) return;
    event.preventDefault();
    if (mode === 'width') {
      nudgeDepartment(id, { width: horizontal });
      return;
    }
    if (mode === 'height') {
      nudgeDepartment(id, { height: vertical });
      return;
    }
    if (mode === 'both' || event.shiftKey) {
      nudgeDepartment(id, { width: horizontal, height: vertical });
      return;
    }
    nudgeDepartment(id, { x: horizontal, y: vertical });
  };

  const startDepartmentGesture = (
    id: string,
    mode: 'move' | 'both' | 'width' | 'height',
    event: ReactPointerEvent<HTMLElement>,
  ) => {
    if (event.button !== 0 || !canEditRef.current) return;
    if (mode === 'move' && event.target instanceof Element && event.target.closest('button, input, a')) return;
    event.preventDefault();
    event.stopPropagation();
    const current = layoutRef.current.departments.find((item) => item.id === id);
    if (!current) return;
    const canvas = departmentCanvasWidth();
    const span = departmentPixelSpan(layoutRef.current.departments);
    const box = departmentVisualBox(current, canvas, span);
    const origin = { x: event.clientX, y: event.clientY, box };
    setRaisedDepartment(id);
    const blockSelect = (ev: Event) => ev.preventDefault();
    document.body.style.userSelect = 'none';
    document.body.style.cursor =
      mode === 'move' ? 'grabbing' : mode === 'height' ? 'ns-resize' : mode === 'width' ? 'ew-resize' : 'nwse-resize';
    document.addEventListener('selectstart', blockSelect);
    const snap = (value: number) => Math.round(value / 8) * 8;
    const move = (ev: PointerEvent) => {
      const dx = snap(ev.clientX - origin.x);
      const dy = snap(ev.clientY - origin.y);
      if (mode === 'move') {
        updateDepartmentBox(id, { x: origin.box.x + dx, y: origin.box.y + dy, width: origin.box.width, height: origin.box.height });
        return;
      }
      updateDepartmentBox(id, {
        x: origin.box.x,
        y: origin.box.y,
        width: mode === 'height' ? origin.box.width : origin.box.width + dx,
        height: mode === 'width' ? origin.box.height : origin.box.height + dy,
      });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      document.removeEventListener('selectstart', blockSelect);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      setRaisedDepartment(null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  const reorderDock = (from: DockKey, to: DockKey) => {
    if (!canEditRef.current || from === to) return;
    const next = [...orderRef.current];
    const fromIndex = next.indexOf(from);
    const toIndex = next.indexOf(to);
    if (fromIndex < 0 || toIndex < 0) return;
    next.splice(fromIndex, 1);
    next.splice(toIndex, 0, from);
    saveOrder(next);
  };

  const startDockDrag = (key: DockKey, event: ReactPointerEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || !canEditRef.current) return;
    const startX = event.clientX;
    const startY = event.clientY;
    let active = false;
    const blockSelect = (ev: Event) => ev.preventDefault();
    const hitKey = (x: number, y: number) => {
      const value = document.elementFromPoint(x, y)?.closest('[data-dock-key]')?.getAttribute('data-dock-key');
      return value && orderRef.current.includes(value as DockKey) ? (value as DockKey) : null;
    };
    const move = (ev: PointerEvent) => {
      if (!active && Math.hypot(ev.clientX - startX, ev.clientY - startY) <= 8) return;
      if (!active) {
        active = true;
        dragged.current = true;
        setDragKey(key);
        document.body.style.userSelect = 'none';
        document.addEventListener('selectstart', blockSelect);
      }
      const over = hitKey(ev.clientX, ev.clientY);
      setDockOver(over && over !== key ? over : null);
      ev.preventDefault();
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      document.removeEventListener('selectstart', blockSelect);
      document.body.style.userSelect = '';
      if (active) {
        const over = hitKey(ev.clientX, ev.clientY);
        if (over) reorderDock(key, over);
        setDragKey(null);
        setDockOver(null);
        ev.preventDefault();
      }
      window.setTimeout(() => {
        dragged.current = false;
      }, 0);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
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
    const previousPending = pendingRecreate;
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
        const baseHash = await contentHash(details.yaml);
        let nextYaml = setComposeServiceUrl(details.yaml, service, url);
        if (publicToStore !== undefined) {
          nextYaml = setComposeServicePublicUrl(nextYaml, service, publicToStore);
        }
        await saveComposeYaml(project.id, nextYaml, baseHash);
        persistUrls(container.name, url, publicToStore);
        setPendingRecreate({ name: container.name, projectId: project.id, service });
        setUrlMessage(home.appUrlSavedRecreate);
      } else {
        persistUrls(container.name, url, publicToStore);
        setUrlMessage(home.appUrlComposeMissing);
      }
    } catch (error) {
      setPendingRecreate(previousPending);
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
  const renderGridItem = (item: (typeof visibleItems)[number]) => {
              if (item.kind === 'link') {
                const { link } = item;
                return (
                  <li key={item.key}>
                    <ContainerTile
                      href={link.url}
                      external
                      name={link.name}
                      appKey={item.key}
                      dimmed={false}
                      dragging={dragContainer === item.key}
                      dropOver={dropTarget === item.key}
                      dropLabel={home.dropHere}
                      detailHref={link.url}
                      detailLabel={link.name}
                      removeLabel={home.linkRemove}
                      onRemove={() => {
                        const nextLinks = homeLinks.filter((entry) => entry.id !== link.id);
                        const nextOrder = containerOrder.filter((entry) => entry !== item.key);
                        const nextMap = { ...appDepartments };
                        delete nextMap[item.key];
                        publish({ links: nextLinks, containerOrder: nextOrder, appDepartments: nextMap });
                      }}
                      onPointerDown={(event) => startAppDrag(item.key, event)}
                      onClick={(event) => {
                        if (!dragged.current) return;
                        event.preventDefault();
                        event.stopPropagation();
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
                    appKey={container.name}
                    dimmed={!runningTile}
                    dragging={dragContainer === container.name}
                    dropOver={dropTarget === container.name}
                    dropLabel={home.dropHere}
                    onPointerDown={(event) => startAppDrag(container.name, event)}
                    onClick={(event) => {
                      if (!dragged.current) return;
                      event.preventDefault();
                      event.stopPropagation();
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
                        title={runningTile ? t.common.running : t.common.stopped}
                      >
                        <span className="sr-only">
                          {runningTile ? t.common.running : t.common.stopped}
                        </span>
                      </span>
                    </span>
                  </ContainerTile>
                </li>
              );
  };

  const renderDepartment = (section: (typeof departmentSections)[number]) => (
    <div
      key={section.id}
      data-department-drop={section.id}
      className={cn(
        'dockora-panel !absolute flex flex-col',
        raisedDepartment === section.id && 'z-30',
        dropDepartment === section.id && 'border-dockora-pink',
      )}
      style={{
        ...departmentFrameStyle(section, canvasWidth, departmentSpan),
        top: fittedDepartments.find((frame) => frame.id === section.id)?.y ?? section.y,
        height: 'auto',
        minHeight: departmentVisualBox(section, canvasWidth, departmentSpan).height,
      }}
    >
      <div
        role="group"
        tabIndex={canEdit ? 0 : undefined}
        aria-label={home.departmentMove}
        aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown Shift+ArrowLeft Shift+ArrowRight Shift+ArrowUp Shift+ArrowDown"
        className="flex cursor-grab items-center gap-3 px-3 py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-dockora-pink active:cursor-grabbing"
        onPointerDown={(event) => startDepartmentGesture(section.id, 'move', event)}
        onKeyDown={(event) => onDepartmentKey(section.id, 'move', event)}
      >
        {renameId === section.id ? (
          <input
            autoFocus
            value={renameDraft}
            aria-label={home.departmentName}
            onChange={(event) => setRenameDraft(event.target.value)}
            onBlur={() => {
              if (renameSkip.current) {
                renameSkip.current = false;
                return;
              }
              const name = renameDraft.trim();
              setRenameId(null);
              if (!name || name.length > 40 || name === section.name) return;
              publish({
                departments: departments.map((entry) =>
                  entry.id === section.id ? { ...entry, name } : entry,
                ),
              });
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                event.currentTarget.blur();
              }
              if (event.key === 'Escape') {
                renameSkip.current = true;
                setRenameId(null);
              }
            }}
            className="dockora-field h-7 w-48 px-2 text-xs"
          />
        ) : canEdit ? (
          <button
            type="button"
            className="dockora-section-tag border-0 bg-transparent p-0"
            onClick={() => {
              setRenameId(section.id);
              setRenameDraft(section.name);
            }}
          >
            {section.name}
          </button>
        ) : (
          <h3 className="dockora-section-tag">{section.name}</h3>
        )}
        {canEdit ? (
          <button
            type="button"
            className="ml-auto text-[10px] font-semibold uppercase tracking-[0.12em] text-dockora-muted hover:text-white"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => {
              const nextMap = { ...appDepartments };
              for (const [key, value] of Object.entries(nextMap)) {
                if (value === section.id) delete nextMap[key];
              }
              publish({
                departments: departments.filter((entry) => entry.id !== section.id),
                appDepartments: nextMap,
              });
            }}
          >
            {home.departmentRemove}
          </button>
        ) : null}
      </div>
      <ul className="grid auto-rows-min grid-cols-[repeat(auto-fill,minmax(7.25rem,1fr))] content-start gap-3 p-3">
        {section.items.map((item) => renderGridItem(item))}
        {section.items.length === 0 ? (
          <li
            data-department-drop={section.id}
            className={cn(
              'dockora-panel col-span-full flex min-h-16 items-center justify-center border border-dashed text-xs uppercase tracking-[0.12em] text-dockora-muted',
              dropDepartment === section.id ? 'border-dockora-pink text-white' : 'border-dockora-border',
            )}
          >
            {home.departmentEmpty}
          </li>
        ) : null}
      </ul>
      {canEdit ? (
        <>
          <div
            role="slider"
            tabIndex={0}
            aria-label={home.departmentResize}
            aria-orientation="horizontal"
            aria-valuemin={200}
            aria-valuemax={1600}
            aria-valuenow={Math.round(departmentVisualBox(section, canvasWidth, departmentSpan).width)}
            className="absolute bottom-11 right-0 top-10 z-10 w-11 cursor-ew-resize touch-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-dockora-pink"
            onPointerDown={(event) => startDepartmentGesture(section.id, 'width', event)}
            onKeyDown={(event) => onDepartmentKey(section.id, 'width', event)}
          />
          <div
            role="slider"
            tabIndex={0}
            aria-label={home.departmentResize}
            aria-orientation="vertical"
            aria-valuemin={160}
            aria-valuemax={1200}
            aria-valuenow={Math.round(departmentVisualBox(section, canvasWidth, departmentSpan).height)}
            className="absolute bottom-0 left-2 right-11 z-10 h-11 cursor-ns-resize touch-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-dockora-pink"
            onPointerDown={(event) => startDepartmentGesture(section.id, 'height', event)}
            onKeyDown={(event) => onDepartmentKey(section.id, 'height', event)}
          />
          <div
            role="group"
            tabIndex={0}
            aria-label={home.departmentResize}
            aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown"
            className="absolute bottom-0 right-0 z-20 h-11 w-11 cursor-nwse-resize touch-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-dockora-pink"
            onPointerDown={(event) => startDepartmentGesture(section.id, 'both', event)}
            onKeyDown={(event) => onDepartmentKey(section.id, 'both', event)}
          >
            <span className="pointer-events-none absolute bottom-1 right-1 h-2 w-2 border-b-2 border-r-2 border-dockora-pink" />
          </div>
        </>
      ) : null}
    </div>
  );

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
              onChange={(event) => {
                setHitIndex(0);
                setQuery(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  setQuery('');
                  return;
                }
                if (pageHits.length === 0) return;
                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  setHitIndex((index) => (index + 1) % pageHits.length);
                } else if (event.key === 'ArrowUp') {
                  event.preventDefault();
                  setHitIndex((index) => (index - 1 + pageHits.length) % pageHits.length);
                } else if (event.key === 'Enter' && activeHit) {
                  event.preventDefault();
                  setQuery('');
                  router.push(activeHit.href);
                }
              }}
              placeholder={home.searchPlaceholder}
              aria-label={home.searchPlaceholder}
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={pageHits.length > 0}
              aria-controls="home-page-hits"
              aria-activedescendant={activeHit ? `home-page-hit-${activeHit.key}` : undefined}
              className="dockora-field w-full px-3.5"
            />
            {pageHits.length > 0 ? (
              <ul id="home-page-hits" role="listbox" className="dockora-panel !absolute left-0 right-0 z-30 mt-2 overflow-hidden py-1">
                {pageHits.map((hit) => (
                  <li key={hit.key} role="presentation">
                    <Link
                      id={`home-page-hit-${hit.key}`}
                      role="option"
                      aria-selected={hit.key === activeHit?.key}
                      href={hit.href}
                      className="block px-4 py-2 text-sm uppercase tracking-wide hover:bg-dockora-accentSoft"
                      onClick={() => setQuery('')}
                    >
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
        {updateError ? <p role="alert" className="text-xs text-dockora-danger">{updateError}</p> : null}
        {layoutError ? <p role="alert" className="text-xs text-dockora-danger">{layoutError}</p> : null}

        <section ref={appsSectionRef} aria-label={home.apps} data-app-grid="" className="relative min-w-0">
          <div
            data-department-drop="loose"
            className={cn(
              'mb-3 flex items-center gap-3',
              dropDepartment === 'loose' && 'border border-dashed border-dockora-pink px-2 py-1',
            )}
          >
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
            {looseItems.map((item) => renderGridItem(item))}
          </ul>
          {departmentSections.length > 0 ? (
            <div
              ref={departmentCanvasRef}
              className="relative mt-6 w-full"
              style={{
                height:
                  fittedDepartments.reduce((max, frame) => Math.max(max, frame.y + frame.height), 0) + 8,
              }}
            >
              {departmentSections.map((section) => renderDepartment(section))}
            </div>
          ) : null}
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
                    data-dock-key={app.key}
                    onPointerDown={(event) => startDockDrag(app.key, event)}
                    onKeyDown={(event) => {
                      if (!event.altKey || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
                      event.preventDefault();
                      const keys = orderRef.current;
                      const index = keys.indexOf(app.key);
                      const neighbor = event.key === 'ArrowLeft' ? keys[index - 1] : keys[index + 1];
                      if (neighbor) reorderDock(app.key, neighbor);
                    }}
                    aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight"
                    onClick={(event) => {
                      if (!dragged.current) return;
                      event.preventDefault();
                      dragged.current = false;
                    }}
                    title={t.nav[app.key]}
                    aria-label={t.nav[app.key]}
                    className={cn(
                      'flex shrink-0 items-center gap-2 px-2.5 py-2 text-[11px] font-medium uppercase tracking-wide text-dockora-muted hover:bg-dockora-accentSoft hover:text-white',
                      dragKey === app.key && 'opacity-50',
                      dockOver === app.key && 'bg-dockora-accentSoft text-white',
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
      {dragContainer && dragPoint
        ? createPortal(
            <div
              className="dockora-panel pointer-events-none fixed z-[90] -translate-x-1/2 -translate-y-[130%] border-dockora-pink px-4 py-2 text-sm shadow-neon"
              style={{ left: dragPoint.x, top: dragPoint.y }}
            >
              {dragLabel}
            </div>,
            document.body,
          )
        : null}
      {addEditor
        ? createPortal(
            <DialogFrame label={home.add} onClose={() => setAddEditor(null)}>
                <div className="flex items-start gap-3 px-5 pt-5">
                  <div className="min-w-0 flex-1">
                    <p className="dockora-section-tag">{home.apps}</p>
                    <h2 className="dockora-title-gradient text-3xl tracking-tight">
                      {addEditor === 'link'
                        ? home.addLink
                        : addEditor === 'department'
                          ? home.addDepartment
                          : home.add}
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
                    <li className="border-t border-dockora-border/70">
                      <button
                        type="button"
                        className="block w-full px-5 py-3 text-left text-sm uppercase tracking-wide hover:bg-white/[0.03]"
                        onClick={() => {
                          setLinkError(null);
                          setDepartmentDraft('');
                          setAddEditor('department');
                        }}
                      >
                        {home.addDepartment}
                      </button>
                    </li>
                  </ul>
                ) : addEditor === 'department' ? (
                  <form
                    className="space-y-3 px-5 py-4"
                    onSubmit={(event) => {
                      event.preventDefault();
                      const name = departmentDraft.trim();
                      if (!name || name.length > 40 || departments.length >= 24) {
                        setLinkError(home.departmentInvalid);
                        return;
                      }
                      const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
                      const y = departments.reduce((max, item) => {
                        const bottom = item.y + item.height;
                        return Number.isFinite(bottom) ? Math.max(max, bottom + 16) : max;
                      }, 0);
                      const canvas = appsSectionRef.current?.clientWidth || 960;
                      publish({
                        departments: [
                          ...departments,
                          {
                            id,
                            name,
                            ...clampDepartmentBox({ x: 0, y, width: Math.min(440, canvas), height: 300 }, canvas),
                          },
                        ],
                      });
                      setDepartmentDraft('');
                      setLinkError(null);
                      setAddEditor(null);
                    }}
                  >
                    <label className="block text-xs font-medium uppercase tracking-wide text-dockora-muted">
                      {home.departmentName}
                      <input
                        autoFocus
                        value={departmentDraft}
                        maxLength={40}
                        onChange={(event) => setDepartmentDraft(event.target.value)}
                        className="dockora-field mt-1 w-full px-3"
                      />
                    </label>
                    {linkError ? <p role="alert" className="text-xs text-dockora-danger">{linkError}</p> : null}
                    <button type="submit" className={buttonClassName({ variant: 'primary', size: 'sm' })}>
                      {home.linkSave}
                    </button>
                  </form>
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
                    {linkError ? <p role="alert" className="text-xs text-dockora-danger">{linkError}</p> : null}
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
            </DialogFrame>,
            document.body,
          )
        : null}
      {linkDialog
        ? createPortal(
            <DialogFrame label={home.chooseLink} onClose={() => setLinkPicker(null)}>
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
            </DialogFrame>,
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
  appKey,
  dimmed,
  dragging,
  dropOver,
  dropLabel,
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
  onClick,
}: {
  href: string;
  external: boolean;
  name: string;
  appKey: string;
  dimmed: boolean;
  dragging: boolean;
  dropOver: boolean;
  dropLabel: string;
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
  onClick: (event: ReactMouseEvent<HTMLElement>) => void;
}) {
  const shell = cn(
    'dockora-panel relative flex cursor-grab select-none flex-col items-center px-2 pb-3 active:cursor-grabbing [&_img]:pointer-events-none',
    dimmed && 'opacity-50',
    dragging && 'opacity-40',
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
      <a href={href} target="_blank" rel="noopener noreferrer" title={name} aria-label={name} className={face} onClick={onClick}>
        {children}
      </a>
    ) : (
      <Link href={href} title={name} aria-label={name} className={face} onClick={onClick}>
        {children}
      </Link>
    );
  return (
    <div
      className={shell}
      data-app-key={appKey}
      onPointerDown={onPointerDown}
      onClickCapture={onClick}
      onContextMenu={(event) => {
        if (!onEdit) return;
        event.preventDefault();
        onEdit();
      }}
    >
      {dropOver ? (
        <div className="absolute inset-0 z-20 flex items-center justify-center border-2 border-dashed border-dockora-pink bg-[#0d0d15] shadow-neon">
          <span className="px-2 text-center font-display text-xs font-semibold uppercase tracking-[0.16em] text-dockora-pink">
            {dropLabel}
          </span>
        </div>
      ) : null}
      {open}
      {detailHref.startsWith('http') ? (
        <a
          href={detailHref}
          target="_blank"
          rel="noopener noreferrer"
          title={name}
          className="mt-2 max-w-full truncate px-2 text-center text-sm text-dockora-text hover:text-dockora-pink"
        >
          {name}
        </a>
      ) : (
        <Link
          href={detailHref}
          title={name}
          aria-label={`${name}. ${detailLabel}`}
          className="mt-2 max-w-full truncate px-2 text-center text-sm text-dockora-text hover:text-dockora-pink"
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
        {alert ? (
          <p role="alert" className="mt-1 truncate text-xs text-dockora-danger">
            {alert}
          </p>
        ) : null}
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
