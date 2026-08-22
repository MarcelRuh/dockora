import { describe, expect, it } from 'vitest';
import {
  formatPorts,
  isUnhealthyContainer,
  mapContainerStatus,
  summarizeContainers,
} from './container-utils.js';

describe('mapContainerStatus', () => {
  it('maps known states', () => {
    expect(mapContainerStatus('running')).toBe('running');
    expect(mapContainerStatus('Exited')).toBe('exited');
    expect(mapContainerStatus('dead')).toBe('dead');
  });

  it('returns unknown for unexpected values', () => {
    expect(mapContainerStatus('weird')).toBe('unknown');
    expect(mapContainerStatus(undefined)).toBe('unknown');
  });
});

describe('formatPorts', () => {
  it('formats published and private ports', () => {
    expect(
      formatPorts([
        { IP: '0.0.0.0', PrivatePort: 80, PublicPort: 8080, Type: 'tcp' },
        { PrivatePort: 5432, Type: 'tcp' },
      ]),
    ).toEqual(['8080->80/tcp', '5432/tcp']);
  });
});

describe('isUnhealthyContainer', () => {
  it('detects unhealthy healthcheck and non-zero exits', () => {
    expect(isUnhealthyContainer({ status: 'running', health: 'unhealthy' })).toBe(true);
    expect(isUnhealthyContainer({ status: 'dead' })).toBe(true);
    expect(isUnhealthyContainer({ status: 'exited', exitCode: 1 })).toBe(true);
    expect(isUnhealthyContainer({ status: 'exited', exitCode: 0 })).toBe(false);
    expect(isUnhealthyContainer({ status: 'running', health: 'healthy' })).toBe(false);
  });
});

describe('summarizeContainers', () => {
  it('aggregates counts', () => {
    const summary = summarizeContainers([
      { status: 'running' },
      { status: 'running', health: 'unhealthy' },
      { status: 'exited', exitCode: 0 },
      { status: 'exited', exitCode: 137 },
      { status: 'paused' },
    ]);

    expect(summary).toEqual({
      total: 5,
      running: 3,
      stopped: 2,
      unhealthy: 2,
    });
  });
});
