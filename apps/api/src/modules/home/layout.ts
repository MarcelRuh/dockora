import {
  HOME_DOCK_KEYS,
  type HomeDepartment,
  type HomeLayout,
  type HomeLink,
  type HomeWidgets,
} from '@dockora/shared';

export const HOME_LAYOUT_KEY = 'homeLayout';

const MAX_LINKS = 40;
const MAX_DEPARTMENTS = 24;
const MAX_ORDER = 200;
const MAX_TEXT = 160;
const MAX_URL = 500;
const MAX_NAME = 80;

const DOCK = new Set<string>(HOME_DOCK_KEYS);

export function emptyHomeLayout(): HomeLayout {
  return {
    appOrder: [],
    containerOrder: [],
    appUrls: {},
    appPublicUrls: {},
    links: [],
    widgets: { system: true, storage: true, network: true },
    departments: [],
    appDepartments: {},
  };
}

export function normalizeHomeLayout(input: unknown): HomeLayout {
  const source = isRecord(input) ? input : {};
  const departments = normalizeDepartments(source.departments);
  return {
    appOrder: stringList(source.appOrder, MAX_ORDER).filter((key) => DOCK.has(key)),
    containerOrder: stringList(source.containerOrder, MAX_ORDER).filter((key) => safeText(key)),
    appUrls: normalizeUrls(source.appUrls),
    appPublicUrls: normalizeUrls(source.appPublicUrls),
    links: normalizeLinks(source.links),
    widgets: normalizeWidgets(source.widgets),
    departments,
    appDepartments: normalizeAppDepartments(source.appDepartments, departments),
  };
}

function normalizeUrls(input: unknown): Record<string, string> {
  if (!isRecord(input)) return {};
  const urls: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!safeText(key) || typeof value !== 'string') continue;
    if (Object.keys(urls).length >= MAX_ORDER) break;
    if (value === '') {
      urls[key] = '';
      continue;
    }
    if (isHttpUrl(value)) urls[key] = value.trim();
  }
  return urls;
}

function normalizeLinks(input: unknown): HomeLink[] {
  if (!Array.isArray(input)) return [];
  const links: HomeLink[] = [];
  const seen = new Set<string>();
  for (const item of input) {
    if (links.length >= MAX_LINKS || !isRecord(item)) continue;
    const id = typeof item.id === 'string' ? item.id.trim() : '';
    const name = typeof item.name === 'string' ? item.name.trim() : '';
    const url = typeof item.url === 'string' ? item.url.trim() : '';
    const icon = typeof item.icon === 'string' ? item.icon.trim() : '';
    if (!/^[a-z0-9-]{4,40}$/i.test(id) || seen.has(id)) continue;
    if (!name || name.length > MAX_NAME) continue;
    if (!isHttpUrl(url) || !isHttpUrl(icon)) continue;
    seen.add(id);
    links.push({ id, name, url, icon });
  }
  return links;
}

function normalizeDepartments(input: unknown): HomeDepartment[] {
  if (!Array.isArray(input)) return [];
  const departments: HomeDepartment[] = [];
  const seen = new Set<string>();
  for (const item of input) {
    if (departments.length >= MAX_DEPARTMENTS || !isRecord(item)) continue;
    const id = typeof item.id === 'string' ? item.id.trim() : '';
    const name = typeof item.name === 'string' ? item.name.trim() : '';
    if (!/^[a-z0-9-]{4,40}$/i.test(id) || seen.has(id) || id.toLowerCase() === 'loose') continue;
    if (!name || name.length > 40 || /[\u0000-\u001f]/.test(name)) continue;
    seen.add(id);
    departments.push({ id, name });
  }
  return departments;
}

function normalizeAppDepartments(input: unknown, departments: HomeDepartment[]): Record<string, string> {
  if (!isRecord(input)) return {};
  const known = new Set(departments.map((item) => item.id));
  const next: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!safeText(key) || typeof value !== 'string' || !known.has(value)) continue;
    if (Object.keys(next).length >= MAX_ORDER) break;
    next[key] = value;
  }
  return next;
}

function normalizeWidgets(input: unknown): HomeWidgets {
  const source = isRecord(input) ? input : {};
  return {
    system: source.system !== false,
    storage: source.storage !== false,
    network: source.network !== false,
  };
}

function stringList(input: unknown, max: number): string[] {
  if (!Array.isArray(input)) return [];
  const next: string[] = [];
  const seen = new Set<string>();
  for (const item of input) {
    if (next.length >= max || typeof item !== 'string') continue;
    const value = item.trim();
    if (!value || value.length > MAX_TEXT || seen.has(value)) continue;
    seen.add(value);
    next.push(value);
  }
  return next;
}

function safeText(value: string): boolean {
  return value.length > 0 && value.length <= MAX_TEXT && !/[\u0000-\u001f]/.test(value);
}

function isHttpUrl(value: string): boolean {
  if (!value || value.length > MAX_URL || /\s/.test(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
