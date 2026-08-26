import { describe, expect, it } from 'vitest';
import { CSRF_COOKIE, CSRF_HEADER, SESSION_COOKIE } from '@dockora/shared';
import { csrfMismatch, isPublicAuthRoute, liftBearerToken } from './auth-gate.js';
import type { FastifyRequest } from 'fastify';

describe('isPublicAuthRoute', () => {
  it('allows health, auth status, login, logout and docs', () => {
    expect(isPublicAuthRoute('GET', '/api/v1/health')).toBe(true);
    expect(isPublicAuthRoute('GET', '/api/v1/auth/status')).toBe(true);
    expect(isPublicAuthRoute('POST', '/api/v1/auth/login')).toBe(true);
    expect(isPublicAuthRoute('POST', '/api/v1/auth/logout')).toBe(true);
    expect(isPublicAuthRoute('GET', '/api/docs')).toBe(true);
    expect(isPublicAuthRoute('GET', '/api/docs/json')).toBe(true);
    expect(isPublicAuthRoute('OPTIONS', '/api/v1/containers')).toBe(true);
  });

  it('blocks protected API routes', () => {
    expect(isPublicAuthRoute('GET', '/api/v1/containers')).toBe(false);
    expect(isPublicAuthRoute('GET', '/api/v1/settings')).toBe(false);
    expect(isPublicAuthRoute('PUT', '/api/v1/settings')).toBe(false);
    expect(isPublicAuthRoute('POST', '/api/v1/auth/users')).toBe(false);
  });

  it('ignores query strings', () => {
    expect(isPublicAuthRoute('GET', '/api/v1/health?x=1')).toBe(true);
    expect(isPublicAuthRoute('GET', '/api/v1/containers?all=1')).toBe(false);
  });
});

describe('liftBearerToken', () => {
  it('lifts token from session cookie', () => {
    const request = {
      headers: {},
      query: {},
      cookies: { [SESSION_COOKIE]: 'cookie.jwt' },
    } as unknown as FastifyRequest;
    liftBearerToken(request);
    expect(request.headers.authorization).toBe('Bearer cookie.jwt');
    expect(request.authSource).toBe('cookie');
  });

  it('lifts token from query', () => {
    const request = {
      headers: {},
      query: { token: 'abc.def' },
      cookies: {},
    } as unknown as FastifyRequest;
    liftBearerToken(request);
    expect(request.headers.authorization).toBe('Bearer abc.def');
    expect(request.authSource).toBe('query');
  });

  it('lifts token from websocket protocol', () => {
    const request = {
      headers: { 'sec-websocket-protocol': 'dockora.jwt.tok.en' },
      query: {},
      cookies: {},
    } as unknown as FastifyRequest;
    liftBearerToken(request);
    expect(request.headers.authorization).toBe('Bearer tok.en');
    expect(request.authSource).toBe('protocol');
  });

  it('keeps existing Authorization header', () => {
    const request = {
      headers: { authorization: 'Bearer keep' },
      query: { token: 'ignore' },
      cookies: { [SESSION_COOKIE]: 'cookie' },
    } as unknown as FastifyRequest;
    liftBearerToken(request);
    expect(request.headers.authorization).toBe('Bearer keep');
    expect(request.authSource).toBe('header');
  });
});

describe('csrfMismatch', () => {
  it('requires matching header when auth came from the cookie', () => {
    const request = {
      method: 'PUT',
      authSource: 'cookie',
      cookies: { [CSRF_COOKIE]: 'abc' },
      headers: { [CSRF_HEADER]: 'abc' },
    } as unknown as FastifyRequest;
    expect(csrfMismatch(request)).toBe(false);
  });

  it('fails when the CSRF header is missing', () => {
    const request = {
      method: 'POST',
      authSource: 'cookie',
      cookies: { [CSRF_COOKIE]: 'abc' },
      headers: {},
    } as unknown as FastifyRequest;
    expect(csrfMismatch(request)).toBe(true);
  });

  it('skips CSRF for bearer API clients and GET', () => {
    expect(
      csrfMismatch({
        method: 'PUT',
        authSource: 'header',
        cookies: { [CSRF_COOKIE]: 'abc' },
        headers: {},
      } as unknown as FastifyRequest),
    ).toBe(false);
    expect(
      csrfMismatch({
        method: 'GET',
        authSource: 'cookie',
        cookies: { [CSRF_COOKIE]: 'abc' },
        headers: {},
      } as unknown as FastifyRequest),
    ).toBe(false);
  });
});
