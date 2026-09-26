import { HOME_DOCK_KEYS, type HomeLayout, type HomeLink, type HomeWidgets } from '@dockora/shared';

const ORDER_KEY = 'dockora.home.appOrder';
const CONTAINER_ORDER_KEY = 'dockora.home.containerOrder';
const URL_KEY = 'dockora.home.appUrls';
const LINKS_KEY = 'dockora.home.links';
const WIDGET_KEY = 'dockora.home.widgets';

export const EMPTY_HOME_LAYOUT: HomeLayout = {
  appOrder: [],
  containerOrder: [],
  appUrls: {},
  links: [],
  widgets: { system: true, storage: true, network: true },
};

export function withDockDefaults(saved: string[]): string[] {
  const known = new Set<string>(HOME_DOCK_KEYS);
  const order = saved.filter((key) => known.has(key));
  const missing = HOME_DOCK_KEYS.filter((key) => !order.includes(key));
  return [...order, ...missing];
}

export function homeLayoutHasData(layout: HomeLayout): boolean {
  return (
    layout.appOrder.length > 0 ||
    layout.containerOrder.length > 0 ||
    layout.links.length > 0 ||
    Object.keys(layout.appUrls).length > 0 ||
    !layout.widgets.system ||
    !layout.widgets.storage ||
    !layout.widgets.network
  );
}

export function pickHomeLayout(input: {
  remoteStored: boolean;
  remote: HomeLayout;
  local: HomeLayout;
  dirty: boolean;
  canEdit: boolean;
}): { layout: HomeLayout; upload: boolean } {
  if (input.dirty) return { layout: input.local, upload: input.canEdit };
  if (input.remoteStored) return { layout: input.remote, upload: false };
  if (input.canEdit && homeLayoutHasData(input.local)) return { layout: input.local, upload: true };
  return { layout: input.local, upload: false };
}

export function readHomeLayoutCache(): HomeLayout {
  if (typeof window === 'undefined') return EMPTY_HOME_LAYOUT;
  return {
    appOrder: readStringList(ORDER_KEY),
    containerOrder: readStringList(CONTAINER_ORDER_KEY),
    appUrls: readUrlMap(),
    links: readLinks(),
    widgets: readWidgets(),
  };
}

export function writeHomeLayoutCache(layout: HomeLayout): void {
  localStorage.setItem(ORDER_KEY, JSON.stringify(layout.appOrder));
  localStorage.setItem(CONTAINER_ORDER_KEY, JSON.stringify(layout.containerOrder));
  localStorage.setItem(URL_KEY, JSON.stringify(layout.appUrls));
  localStorage.setItem(LINKS_KEY, JSON.stringify(layout.links));
  localStorage.setItem(WIDGET_KEY, JSON.stringify(layout.widgets));
}

function readStringList(key: string): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(key) ?? '[]') as unknown;
    return Array.isArray(raw) ? raw.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function readUrlMap(): Record<string, string> {
  try {
    const raw = JSON.parse(localStorage.getItem(URL_KEY) ?? '{}') as unknown;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    return Object.fromEntries(
      Object.entries(raw).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
    );
  } catch {
    return {};
  }
}

function readLinks(): HomeLink[] {
  try {
    const raw = JSON.parse(localStorage.getItem(LINKS_KEY) ?? '[]') as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.filter(
      (item): item is HomeLink =>
        Boolean(item) &&
        typeof item === 'object' &&
        typeof (item as HomeLink).id === 'string' &&
        typeof (item as HomeLink).name === 'string' &&
        typeof (item as HomeLink).url === 'string' &&
        typeof (item as HomeLink).icon === 'string',
    );
  } catch {
    return [];
  }
}

function readWidgets(): HomeWidgets {
  try {
    const raw = JSON.parse(localStorage.getItem(WIDGET_KEY) ?? '{}') as Partial<HomeWidgets>;
    return {
      system: raw.system !== false,
      storage: raw.storage !== false,
      network: raw.network !== false,
    };
  } catch {
    return { system: true, storage: true, network: true };
  }
}
