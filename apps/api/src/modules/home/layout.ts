import { HOME_DOCK_KEYS, type HomeLayout, type HomeLink, type HomeWidgets } from '@dockora/shared';

export const HOME_LAYOUT_KEY = 'homeLayout';

const MAX_LINKS = 40;
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
    links: [],
    widgets: { system: true, storage: true, network: true },
  };
}

export function normalizeHomeLayout(input: unknown): HomeLayout {
  const source = isRecord(input) ? input : {};
  return {
    appOrder: stringList(source.appOrder, MAX_ORDER).filter((key) => DOCK.has(key)),
    containerOrder: stringList(source.containerOrder, MAX_ORDER).filter((key) => safeText(key)),
    appUrls: normalizeUrls(source.appUrls),
    links: normalizeLinks(source.links),
    widgets: normalizeWidgets(source.widgets),
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
