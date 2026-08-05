import { API_PREFIX } from '@dockora/shared';
import type { FastifyRequest } from 'fastify';
import {
  PrismaSettingsRepository,
  SettingsService,
} from '../settings/settings.service.js';

const settings = new SettingsService(new PrismaSettingsRepository());

let cache: { value: boolean; at: number } | null = null;
const CACHE_TTL_MS = 5_000;

export function invalidateAuthEnabledCache(): void {
  cache = null;
}

export async function isAuthEnabled(): Promise<boolean> {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_TTL_MS) {
    return cache.value;
  }
  const current = await settings.getSettings();
  cache = { value: current.authEnabled, at: now };
  return current.authEnabled;
}

/** Öffentliche Routen – auch wenn Auth aktiv ist. */
export function isPublicAuthRoute(method: string, url: string): boolean {
  const path = url.split('?')[0] ?? url;

  if (path.startsWith('/api/docs')) return true;
  if (method === 'OPTIONS') return true;

  if (method === 'GET' && path === `${API_PREFIX}/health`) return true;
  if (method === 'GET' && path === `${API_PREFIX}/auth/status`) return true;
  if (method === 'POST' && path === `${API_PREFIX}/auth/login`) return true;

  return false;
}

/**
 * Browser-WebSockets können kein Authorization-Header setzen.
 * Token kommt per Query `?token=` oder Sec-WebSocket-Protocol `dockora.jwt.<token>`.
 */
export function liftBearerToken(request: FastifyRequest): void {
  if (request.headers.authorization) return;

  const queryToken = (request.query as { token?: string } | undefined)?.token;
  if (queryToken) {
    request.headers.authorization = `Bearer ${queryToken}`;
    return;
  }

  const protoHeader = request.headers['sec-websocket-protocol'];
  if (!protoHeader) return;
  const parts = String(protoHeader)
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  for (const part of parts) {
    if (part.startsWith('dockora.jwt.')) {
      request.headers.authorization = `Bearer ${part.slice('dockora.jwt.'.length)}`;
      return;
    }
  }
}
