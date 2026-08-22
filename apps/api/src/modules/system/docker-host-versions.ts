import { request } from 'undici';
import { compareDockoraVersions } from './self-update.service.js';

const CACHE_MS = 15 * 60 * 1000;
const UA = 'dockora-docker-check';

let cache: { at: number; engine: string | null; compose: string | null } | null = null;

export function normalizeDockerVersion(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;
  const match = /v?(\d+\.\d+\.\d+)/i.exec(raw.trim());
  return match?.[1] ?? null;
}

/** First stable vX.Y.Z title in a GitHub releases atom feed. */
export function parseGithubReleaseAtomTag(atom: string): string | null {
  const titles = [...atom.matchAll(/<title>([^<]+)<\/title>/gi)].map((m) =>
    decodeXml(m[1]!.trim()),
  );
  for (const title of titles.slice(1)) {
    const match = /^v?(\d+\.\d+\.\d+)$/.exec(title);
    if (match?.[1]) return match[1];
  }
  return null;
}

export function parseDockerStaticListing(html: string): string | null {
  const found: string[] = [];
  for (const match of html.matchAll(/docker-(\d+\.\d+\.\d+)\.tgz/g)) {
    if (match[1]) found.push(match[1]);
  }
  if (found.length === 0) return null;
  found.sort(compareDockoraVersions);
  return found[found.length - 1] ?? null;
}

export function dockerUpdateAvailable(
  current: string | null | undefined,
  latest: string | null | undefined,
): boolean {
  const a = normalizeDockerVersion(current);
  const b = normalizeDockerVersion(latest);
  if (!a || !b) return false;
  return compareDockoraVersions(b, a) > 0;
}

export async function fetchDockerComponentLatest(): Promise<{
  engine: string | null;
  compose: string | null;
}> {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_MS) {
    return { engine: cache.engine, compose: cache.compose };
  }

  const [engine, compose] = await Promise.all([
    fetchLatestEngine().catch(() => null),
    fetchLatestCompose().catch(() => null),
  ]);
  cache = { at: now, engine, compose };
  return { engine, compose };
}

export function clearDockerLatestCache(): void {
  cache = null;
}

async function fetchLatestEngine(): Promise<string | null> {
  const fromAtom = await fetchAtomTag('https://github.com/moby/moby/releases.atom');
  if (fromAtom) return fromAtom;
  const arch = dockerStaticArch();
  const { status, text } = await readBody(
    `https://download.docker.com/linux/static/stable/${arch}/`,
  );
  if (status >= 400) return null;
  return parseDockerStaticListing(text);
}

async function fetchLatestCompose(): Promise<string | null> {
  return fetchAtomTag('https://github.com/docker/compose/releases.atom');
}

async function fetchAtomTag(url: string): Promise<string | null> {
  const { status, text } = await readBody(url);
  if (status >= 400) return null;
  return parseGithubReleaseAtomTag(text);
}

async function readBody(url: string): Promise<{ status: number; text: string }> {
  const res = await request(url, {
    headers: {
      Accept: 'application/atom+xml, text/html;q=0.8, */*;q=0.5',
      'User-Agent': UA,
    },
    signal: AbortSignal.timeout(5_000),
  });
  return { status: res.statusCode, text: await res.body.text() };
}

function dockerStaticArch(): string {
  if (process.arch === 'arm64') return 'aarch64';
  return 'x86_64';
}

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"');
}
