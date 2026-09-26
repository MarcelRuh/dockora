const SPECIFIC_SUFFIXES = ['_APP_URL', '_PUBLIC_URL', '_BASE_URL', '_EXTERNAL_URL', '_URL'] as const;
const GENERIC_KEYS = ['APP_URL', 'PUBLIC_URL', 'BASE_URL', 'EXTERNAL_URL'] as const;

export function parseDotEnv(content: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const eq = trimmed.indexOf('=');
    const key = trimmed.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    env[key] = unquote(trimmed.slice(eq + 1).trim());
  }
  return env;
}

/**
 * Public app URL for one Compose service.
 * Service-specific keys always win. Generic APP_URL applies only when the
 * project has a single service or that service references the key.
 */
export function discoverServicePublicUrl(input: {
  env: Record<string, string>;
  service: string;
  singleService?: boolean;
  referencedKeys?: string[];
  literals?: Record<string, string>;
}): string | null {
  const prefix = input.service.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '');
  const referenced = new Set((input.referencedKeys ?? []).map((key) => key.toUpperCase()));
  for (const suffix of SPECIFIC_SUFFIXES) {
    const key = `${prefix}${suffix}`;
    const hit = httpUrl(input.literals?.[key]) ?? httpUrl(input.env[key]);
    if (hit) return hit;
  }
  for (const key of GENERIC_KEYS) {
    const literal = httpUrl(input.literals?.[key]);
    if (literal) return literal;
    const fromEnv = httpUrl(input.env[key]);
    if (fromEnv && (input.singleService || referenced.has(key))) return fromEnv;
  }
  return null;
}

export function discoverProjectPublicUrls(input: {
  envText: string;
  services: string[];
  yaml?: string;
}): Record<string, string> {
  const env = parseDotEnv(input.envText);
  const urls: Record<string, string> = {};
  const singleService = input.services.length === 1;
  for (const service of input.services) {
    const block = input.yaml ? serviceBlock(input.yaml, service) : '';
    const url = discoverServicePublicUrl({
      env,
      service,
      singleService,
      referencedKeys: referencedKeys(block),
      literals: literalUrls(block),
    });
    if (url) urls[service] = url;
  }
  return urls;
}

function referencedKeys(block: string): string[] {
  const keys = new Set<string>();
  for (const match of block.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)/g)) {
    keys.add(match[1]!.toUpperCase());
  }
  return [...keys];
}

function literalUrls(block: string): Record<string, string> {
  const urls: Record<string, string> = {};
  for (const line of block.split(/\r?\n/)) {
    const match = /^\s*(?:-\s*)?([A-Za-z_][A-Za-z0-9_]*)[=:]\s*(.+?)\s*$/.exec(line.trim());
    if (!match) continue;
    const value = unquote(match[2]!.trim());
    if (/^https?:\/\//i.test(value)) urls[match[1]!.toUpperCase()] = value;
  }
  return urls;
}

function serviceBlock(yaml: string, service: string): string {
  const lines = yaml.split(/\r?\n/);
  const header = `  ${service}:`;
  const start = lines.findIndex((line) => line.replace(/\t/g, '  ').startsWith(header));
  if (start < 0) return '';
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i]!.replace(/\t/g, '  ');
    if (/^(  [A-Za-z0-9][A-Za-z0-9._-]*:|\S)/.test(line) && !line.startsWith('    ')) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join('\n');
}

function unquote(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  const comment = value.indexOf(' #');
  return (comment >= 0 ? value.slice(0, comment) : value).trim();
}

function httpUrl(value: string | undefined): string | null {
  const trimmed = unquote(value?.trim() ?? '');
  if (!trimmed || trimmed.length > 500 || /\s/.test(trimmed)) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return trimmed;
  } catch {
    return null;
  }
}
