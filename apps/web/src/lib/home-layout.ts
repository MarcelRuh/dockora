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

export function departmentUsesFraction(box: { x: number; width: number }): boolean {
  return box.x >= 0 && box.x <= 1 && box.width > 0 && box.width <= 1;
}

export function departmentPixelSpan(departments: Array<{ x: number; width: number }>): number {
  return departments.reduce((max, item) => {
    if (departmentUsesFraction(item)) return max;
    return Math.max(max, item.x + item.width);
  }, 0);
}

/** Pixel box on the current canvas. Legacy pixel layouts shrink so the right edge stays inside. */
export function departmentVisualBox(
  box: Pick<HomeDepartment, 'x' | 'y' | 'width' | 'height'>,
  canvasWidth: number,
  pixelSpan: number,
): Pick<HomeDepartment, 'x' | 'y' | 'width' | 'height'> {
  if (canvasWidth > 0 && departmentUsesFraction(box)) {
    return { x: box.x * canvasWidth, y: box.y, width: box.width * canvasWidth, height: box.height };
  }
  if (canvasWidth > 0 && !departmentUsesFraction(box)) {
    const scale = canvasWidth / Math.max(canvasWidth, pixelSpan);
    return { x: box.x * scale, y: box.y, width: box.width * scale, height: box.height };
  }
  return box;
}

export interface DepartmentFrame {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Grows a department to its apps and shifts departments that were placed below it.
 * Side-by-side departments stay on their row.
 */
export function fitDepartmentLayout(
  boxes: DepartmentFrame[],
  contentHeights: Record<string, number>,
): DepartmentFrame[] {
  const heightOf = (box: DepartmentFrame) => Math.max(box.height, contentHeights[box.id] ?? 0);
  const tops = new Map(boxes.map((box) => [box.id, box.y]));
  const ordered = [...boxes].sort((a, b) => a.y - b.y || a.x - b.x);
  for (let pass = 0; pass < ordered.length; pass += 1) {
    let moved = false;
    for (const above of ordered) {
      const aboveTop = tops.get(above.id) ?? above.y;
      const aboveBottom = aboveTop + heightOf(above);
      for (const below of ordered) {
        if (below.id === above.id) continue;
        if (below.y + 1 < above.y + above.height) continue;
        const gap = Math.max(0, below.y - (above.y + above.height));
        const minTop = aboveBottom + gap;
        const current = tops.get(below.id) ?? below.y;
        if (current + 0.5 < minTop) {
          tops.set(below.id, minTop);
          moved = true;
        }
      }
    }
    if (!moved) break;
  }
  return boxes.map((box) => ({
    ...box,
    y: tops.get(box.id) ?? box.y,
    height: heightOf(box),
  }));
}

/** Stores x and width as fractions of the canvas so the same layout fits a narrower screen. */
/** Moves or resizes a department by pixel deltas and stores the clamped box. */
export function nudgeDepartmentBox(
  stored: Pick<HomeDepartment, 'x' | 'y' | 'width' | 'height'>,
  canvasWidth: number,
  pixelSpan: number,
  delta: Partial<Pick<HomeDepartment, 'x' | 'y' | 'width' | 'height'>>,
): Pick<HomeDepartment, 'x' | 'y' | 'width' | 'height'> {
  const visual = departmentVisualBox(stored, canvasWidth, pixelSpan);
  return clampDepartmentBox(
    {
      x: visual.x + (delta.x ?? 0),
      y: visual.y + (delta.y ?? 0),
      width: visual.width + (delta.width ?? 0),
      height: visual.height + (delta.height ?? 0),
    },
    canvasWidth,
  );
}

export function clampDepartmentBox(
  visual: Pick<HomeDepartment, 'x' | 'y' | 'width' | 'height'>,
  canvasWidth: number,
): Pick<HomeDepartment, 'x' | 'y' | 'width' | 'height'> {
  const canvas = Math.max(canvasWidth, 1);
  const minWidth = Math.min(1, 200 / canvas);
  let x = Math.min(1, Math.max(0, visual.x / canvas));
  let width = Math.min(1, Math.max(minWidth, visual.width / canvas));
  if (x + width > 1) width = 1 - x;
  if (width < minWidth) {
    width = minWidth;
    x = 1 - minWidth;
  }
  return {
    x: Math.round(x * 10000) / 10000,
    y: Math.min(2400, Math.max(0, Math.round(visual.y))),
    width: Math.round(width * 10000) / 10000,
    height: Math.min(1200, Math.max(160, Math.round(visual.height))),
  };
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
