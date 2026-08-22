import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { request } from 'undici';

const execFileAsync = promisify(execFile);

const SHA_RE = /^[a-f0-9]{40}$/i;
const CACHE_MS = 5 * 60 * 1000;

let shaCache: { key: string; sha: string; at: number } | null = null;
let versionCache: { key: string; version: string; at: number } | null = null;

export function parseGitUploadPackRefs(raw: string): Record<string, string> {
  const refs: Record<string, string> = {};
  let i = 0;
  while (i + 4 <= raw.length) {
    const lenHex = raw.slice(i, i + 4);
    if (!/^[0-9a-fA-F]{4}$/.test(lenHex)) break;
    const len = Number.parseInt(lenHex, 16);
    if (len === 0) {
      i += 4;
      continue;
    }
    if (len < 4 || i + len > raw.length) break;
    let payload = raw.slice(i + 4, i + len);
    i += len;
    if (payload.startsWith('#')) continue;
    const nul = payload.indexOf('\0');
    if (nul >= 0) payload = payload.slice(0, nul);
    payload = payload.replace(/\r?\n$/, '').trim();
    const match = /^([a-f0-9]{40})\s+(\S+)/i.exec(payload);
    if (match?.[1] && match[2]) refs[match[2]] = match[1].toLowerCase();
  }
  return refs;
}

export function pickBranchSha(refs: Record<string, string>, branch: string): string | null {
  return refs[`refs/heads/${branch}`] ?? refs.HEAD ?? null;
}

export function parseGithubAtomHeadSha(xml: string): string | null {
  const match = /tag:github\.com,2008:Grit::Commit\/([a-f0-9]{40})/i.exec(xml);
  return match?.[1] ? match[1].toLowerCase() : null;
}

function asSha(value: string | null | undefined): string | null {
  const sha = value?.trim().toLowerCase() ?? '';
  return SHA_RE.test(sha) ? sha : null;
}

async function readBody(url: string, headers: Record<string, string>): Promise<{ status: number; text: string }> {
  const res = await request(url, { headers });
  const text = await res.body.text();
  return { status: res.statusCode, text };
}

async function fetchViaGitLsRemote(repo: string, branch: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['ls-remote', `https://github.com/${repo}.git`, `refs/heads/${branch}`],
      { timeout: 15_000, maxBuffer: 256 * 1024 },
    );
    return asSha(stdout.trim().split(/\s+/)[0]);
  } catch {
    return null;
  }
}

async function fetchViaUploadPack(repo: string, branch: string): Promise<string | null> {
  const { status, text } = await readBody(
    `https://github.com/${repo}.git/info/refs?service=git-upload-pack`,
    {
      Accept: 'application/x-git-upload-pack-advertisement',
      'User-Agent': 'git/2.43.0',
    },
  );
  if (status >= 400) {
    throw new Error(`git-upload-pack ${status}`);
  }
  return pickBranchSha(parseGitUploadPackRefs(text), branch);
}

async function fetchViaAtom(repo: string, branch: string): Promise<string | null> {
  const { status, text } = await readBody(`https://github.com/${repo}/commits/${encodeURIComponent(branch)}.atom`, {
    Accept: 'application/atom+xml',
    'User-Agent': 'dockora-self-update',
  });
  if (status >= 400) {
    throw new Error(`GitHub atom ${status}`);
  }
  return parseGithubAtomHeadSha(text);
}

async function fetchViaRestApi(repo: string, branch: string, token: string | null): Promise<string | null> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'dockora-self-update',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const { status, text } = await readBody(
    `https://api.github.com/repos/${repo}/commits/${encodeURIComponent(branch)}`,
    headers,
  );
  if (status >= 400) {
    throw new Error(`GitHub API ${status}`);
  }
  const body = JSON.parse(text) as { sha?: string };
  return asSha(body.sha);
}

function githubToken(): string | null {
  const token = process.env.GITHUB_TOKEN?.trim() || process.env.GH_TOKEN?.trim() || '';
  return token || null;
}

export function parseNpmPackageVersion(raw: string): string | null {
  try {
    const pkg = JSON.parse(raw) as { version?: unknown };
    return typeof pkg.version === 'string' && pkg.version.trim() ? pkg.version.trim() : null;
  } catch {
    return null;
  }
}

/** Newest-first CHANGELOG sections until `currentVersion` (exclusive). */
export function extractChangelogSince(markdown: string, currentVersion: string): string {
  const chunks = markdown.split(/^## /m).slice(1);
  const sections: string[] = [];
  for (const chunk of chunks) {
    const header = chunk.split('\n', 1)[0]?.trim() ?? '';
    const version = /\[([^\]]+)\]/.exec(header)?.[1] ?? header.replace(/[–-].*$/, '').trim();
    if (!version || version.toLowerCase() === 'unreleased') continue;
    if (version === currentVersion) break;
    sections.push(`## ${chunk.trim()}`);
    if (sections.join('\n\n').length >= 4000) break;
  }
  const text = sections.join('\n\n').trim();
  return text.length > 4500 ? `${text.slice(0, 4490).trim()}…` : text;
}

/**
 * Resolve the tip SHA of a public GitHub branch without depending on the
 * unauthenticated REST API (60 req/h → 403 on wget/shared-IP installs).
 */
export async function fetchGithubCommitSha(repo: string, branch: string): Promise<string> {
  const key = `${repo}@${branch}`;
  const now = Date.now();
  if (shaCache && shaCache.key === key && now - shaCache.at < CACHE_MS) {
    return shaCache.sha;
  }

  const errors: string[] = [];
  const attempts: Array<() => Promise<string | null>> = [
    () => fetchViaGitLsRemote(repo, branch),
    () => fetchViaUploadPack(repo, branch),
    () => fetchViaAtom(repo, branch),
    () => fetchViaRestApi(repo, branch, githubToken()),
  ];

  for (const attempt of attempts) {
    try {
      const sha = asSha(await attempt());
      if (sha) {
        shaCache = { key, sha, at: now };
        return sha;
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  throw new Error(errors[0] ? `Remote-Revision unbekannt (${errors.join('; ')})` : 'Remote-Revision unbekannt');
}

/** package.json version for a public GitHub ref (branch or commit SHA). */
export async function fetchGithubPackageVersion(repo: string, ref: string): Promise<string | null> {
  const key = `${repo}@${ref}`;
  const now = Date.now();
  if (versionCache && versionCache.key === key && now - versionCache.at < CACHE_MS) {
    return versionCache.version;
  }

  const { status, text } = await readBody(
    `https://raw.githubusercontent.com/${repo}/${encodeURIComponent(ref)}/package.json`,
    {
      Accept: 'application/json',
      'User-Agent': 'dockora-self-update',
      'Cache-Control': 'no-cache',
    },
  );
  if (status >= 400) {
    throw new Error(`GitHub package.json ${status}`);
  }
  const version = parseNpmPackageVersion(text);
  if (!version) return null;
  versionCache = { key, version, at: now };
  return version;
}

let changelogCache: { key: string; text: string; at: number } | null = null;

export async function fetchGithubChangelog(
  repo: string,
  ref: string,
  currentVersion: string,
): Promise<string | null> {
  const key = `${repo}@${ref}@${currentVersion}`;
  const now = Date.now();
  if (changelogCache && changelogCache.key === key && now - changelogCache.at < CACHE_MS) {
    return changelogCache.text || null;
  }

  const { status, text } = await readBody(
    `https://raw.githubusercontent.com/${repo}/${encodeURIComponent(ref)}/CHANGELOG.md`,
    {
      Accept: 'text/plain',
      'User-Agent': 'dockora-self-update',
      'Cache-Control': 'no-cache',
    },
  );
  if (status >= 400) {
    throw new Error(`GitHub changelog ${status}`);
  }
  const extracted = extractChangelogSince(text, currentVersion);
  changelogCache = { key, text: extracted, at: now };
  return extracted || null;
}

export function clearGithubShaCache(): void {
  shaCache = null;
  versionCache = null;
  changelogCache = null;
}
