import {
  HOME_DOCK_KEYS,
  type HomeDepartment,
  type HomeLayout,
  type HomeLink,
  type HomeWidgets,
} from '@dockora/shared';

const ORDER_KEY = 'dockora.home.appOrder';
const CONTAINER_ORDER_KEY = 'dockora.home.containerOrder';
const URL_KEY = 'dockora.home.appUrls';
const PUBLIC_URL_KEY = 'dockora.home.appPublicUrls';
const LINKS_KEY = 'dockora.home.links';
const WIDGET_KEY = 'dockora.home.widgets';
const DEPARTMENT_KEY = 'dockora.home.departments';
const APP_DEPARTMENT_KEY = 'dockora.home.appDepartments';

export const EMPTY_HOME_LAYOUT: HomeLayout = {
  appOrder: [],
  containerOrder: [],
  appUrls: {},
  appPublicUrls: {},
  links: [],
  widgets: { system: true, storage: true, network: true },
  departments: [],
  appDepartments: {},
};

export function completeHomeLayout(layout: Partial<HomeLayout> | null | undefined): HomeLayout {
  const source = layout ?? {};
  return {
    ...EMPTY_HOME_LAYOUT,
    ...source,
    appOrder: source.appOrder ?? [],
    containerOrder: source.containerOrder ?? [],
    appUrls: source.appUrls ?? {},
    appPublicUrls: source.appPublicUrls ?? {},
    links: source.links ?? [],
    widgets: { ...EMPTY_HOME_LAYOUT.widgets, ...source.widgets },
    departments: normalizeStoredDepartments(source.departments),
    appDepartments: source.appDepartments ?? {},
  };
}

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
    Object.keys(layout.appPublicUrls).length > 0 ||
    layout.departments.length > 0 ||
    Object.keys(layout.appDepartments).length > 0 ||
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
    appUrls: readUrlMap(URL_KEY),
    appPublicUrls: readUrlMap(PUBLIC_URL_KEY),
    links: readLinks(),
    widgets: readWidgets(),
    departments: normalizeStoredDepartments(readRawDepartments()),
    appDepartments: readUrlMap(APP_DEPARTMENT_KEY),
  };
}

export function writeHomeLayoutCache(layout: HomeLayout): void {
  localStorage.setItem(ORDER_KEY, JSON.stringify(layout.appOrder));
  localStorage.setItem(CONTAINER_ORDER_KEY, JSON.stringify(layout.containerOrder));
  localStorage.setItem(URL_KEY, JSON.stringify(layout.appUrls));
  localStorage.setItem(PUBLIC_URL_KEY, JSON.stringify(layout.appPublicUrls));
  localStorage.setItem(LINKS_KEY, JSON.stringify(layout.links));
  localStorage.setItem(WIDGET_KEY, JSON.stringify(layout.widgets));
  localStorage.setItem(DEPARTMENT_KEY, JSON.stringify(layout.departments));
  localStorage.setItem(APP_DEPARTMENT_KEY, JSON.stringify(layout.appDepartments));
}

function readStringList(key: string): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(key) ?? '[]') as unknown;
    return Array.isArray(raw) ? raw.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function readUrlMap(key: string): Record<string, string> {
  try {
    const raw = JSON.parse(localStorage.getItem(key) ?? '{}') as unknown;
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

function readRawDepartments(): unknown {
  try {
    return JSON.parse(localStorage.getItem(DEPARTMENT_KEY) ?? '[]') as unknown;
  } catch {
    return [];
  }
}

export function normalizeStoredDepartments(input: unknown): HomeDepartment[] {
  if (!Array.isArray(input)) return [];
  return input.flatMap((item, index) => {
    if (!item || typeof item !== 'object') return [];
    const entry = item as Partial<HomeDepartment>;
    if (typeof entry.id !== 'string' || typeof entry.name !== 'string') return [];
    const finite = (value: unknown) => typeof value === 'number' && Number.isFinite(value);
    const box =
      finite(entry.x) && finite(entry.y) && finite(entry.width) && finite(entry.height)
        ? {
            x: entry.x as number,
            y: entry.y as number,
            width: entry.width as number,
            height: entry.height as number,
          }
        : { x: 0, y: index * 316, width: 440, height: 300 };
    return [{ id: entry.id, name: entry.name, ...box }];
  });
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
