import { API_PREFIX, CSRF_COOKIE, CSRF_HEADER, SESSION_COOKIE } from '@dockora/shared';
import type { FastifyRequest } from 'fastify';
import {
  PrismaSettingsRepository,
  SettingsService,
} from '../settings/settings.service.js';
import { headerValue } from './session-cookies.js';

const settings = new SettingsService(new PrismaSettingsRepository());

let cache: { value: boolean; at: number } | null = null;
const CACHE_TTL_MS = 5_000;

export type AuthTokenSource = 'header' | 'cookie' | 'query' | 'protocol';

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

  if (method === 'OPTIONS') return true;

  if (method === 'GET' && path === `${API_PREFIX}/health`) return true;
  if (method === 'GET' && path === `${API_PREFIX}/auth/status`) return true;
  if (method === 'POST' && path === `${API_PREFIX}/auth/login`) return true;
  if (method === 'POST' && path === `${API_PREFIX}/auth/login/totp`) return true;
  if (method === 'POST' && path === `${API_PREFIX}/auth/logout`) return true;

  return false;
}

export function isUnsafeMethod(method: string): boolean {
  return method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE';
}

/**
 * CSRF double-submit: required when the session came from the HttpOnly cookie.
 * Bearer Authorization from API clients is not CSRF-checked.
 */
export function csrfMismatch(request: FastifyRequest): boolean {
  if (!isUnsafeMethod(request.method)) return false;
  if (request.authSource !== 'cookie') return false;
  const cookie = request.cookies?.[CSRF_COOKIE];
  const header = headerValue(request.headers[CSRF_HEADER]);
  return !cookie || !header || cookie !== header;
}

/**
 * Browser-WebSockets können kein Authorization-Header setzen.
 * Token kommt per Cookie, Query `?token=` oder Sec-WebSocket-Protocol `dockora.jwt.<token>`.
 */
export function liftBearerToken(request: FastifyRequest): void {
  if (request.headers.authorization) {
    request.authSource = 'header';
    return;
  }

  const cookieToken = request.cookies?.[SESSION_COOKIE];
  if (cookieToken) {
    request.headers.authorization = `Bearer ${cookieToken}`;
    request.authSource = 'cookie';
    return;
  }

  const queryToken = (request.query as { token?: string } | undefined)?.token;
  if (queryToken) {
    request.headers.authorization = `Bearer ${queryToken}`;
    request.authSource = 'query';
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
      request.authSource = 'protocol';
      return;
    }
  }
}

declare module 'fastify' {
  interface FastifyRequest {
    authSource?: AuthTokenSource;
  }
}
