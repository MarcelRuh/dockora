import { describe, expect, it } from 'vitest';
import { withAuthQuery } from './sse';

describe('withAuthQuery', () => {
  it('keeps same-origin URLs free of the JWT', () => {
    expect(withAuthQuery('/api/v1/events/stream', { token: 'secret.jwt', crossOrigin: false })).toBe(
      '/api/v1/events/stream',
    );
  });

  it('appends token only for cross-origin EventSource', () => {
    expect(withAuthQuery('/api/v1/dashboard/stream', { token: 'secret.jwt', crossOrigin: true })).toBe(
      '/api/v1/dashboard/stream?token=secret.jwt',
    );
    expect(
      withAuthQuery('/api/v1/containers/abc/logs/stream?follow=1', { token: 'a.b', crossOrigin: true }),
    ).toBe('/api/v1/containers/abc/logs/stream?follow=1&token=a.b');
  });

  it('does not append an empty token', () => {
    expect(withAuthQuery('/api/v1/dashboard/stream', { token: null, crossOrigin: true })).toBe(
      '/api/v1/dashboard/stream',
    );
  });
});
