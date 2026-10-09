import { describe, expect, it } from 'vitest';
import {
  affectsComposeDiscovery,
  dockerActionName,
  isLiveContainerStatus,
  isNoisyDockerAction,
} from './resource-events.js';

describe('resource-events', () => {
  it('treats exec/attach/health noise as ignorable', () => {
    expect(isNoisyDockerAction('exec_start')).toBe(true);
    expect(isNoisyDockerAction('attach')).toBe(true);
    expect(isNoisyDockerAction('start')).toBe(false);
    expect(isNoisyDockerAction('health_status:unhealthy')).toBe(true);
    expect(isNoisyDockerAction('health_status:healthy')).toBe(true);
  });

  it('strips health_status suffixes', () => {
    expect(dockerActionName('health_status:healthy')).toBe('health_status');
    expect(dockerActionName('exec_start:foo')).toBe('exec_start');
    expect(dockerActionName('start')).toBe('start');
  });

  it('limits compose discovery invalidation to structural actions', () => {
    expect(affectsComposeDiscovery('start')).toBe(true);
    expect(affectsComposeDiscovery('rename')).toBe(true);
    expect(affectsComposeDiscovery('health_status:healthy')).toBe(false);
    expect(affectsComposeDiscovery('attach')).toBe(false);
  });

  it('keeps paused/restarting in the live subset', () => {
    expect(isLiveContainerStatus('running')).toBe(true);
    expect(isLiveContainerStatus('paused')).toBe(true);
    expect(isLiveContainerStatus('exited')).toBe(false);
  });
});
