import { describe, expect, it } from 'vitest';
import { isPublicAuthRoute, liftBearerToken } from './auth-gate.js';
import type { FastifyRequest } from 'fastify';

describe('isPublicAuthRoute', () => {
  it('allows health, auth status, login and docs', () => {
    expect(isPublicAuthRoute('GET', '/api/v1/health')).toBe(true);
    expect(isPublicAuthRoute('GET', '/api/v1/auth/status')).toBe(true);
    expect(isPublicAuthRoute('POST', '/api/v1/auth/login')).toBe(true);
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
  it('lifts token from query', () => {
    const request = {
      headers: {},
      query: { token: 'abc.def' },
    } as unknown as FastifyRequest;
    liftBearerToken(request);
    expect(request.headers.authorization).toBe('Bearer abc.def');
  });

  it('lifts token from websocket protocol', () => {
    const request = {
      headers: { 'sec-websocket-protocol': 'dockora.jwt.tok.en' },
      query: {},
    } as unknown as FastifyRequest;
    liftBearerToken(request);
    expect(request.headers.authorization).toBe('Bearer tok.en');
  });

  it('keeps existing Authorization header', () => {
    const request = {
      headers: { authorization: 'Bearer keep' },
      query: { token: 'ignore' },
    } as unknown as FastifyRequest;
    liftBearerToken(request);
    expect(request.headers.authorization).toBe('Bearer keep');
  });
});
