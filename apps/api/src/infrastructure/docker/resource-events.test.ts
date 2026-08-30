import { describe, expect, it } from 'vitest';
import {
  dockerActionName,
  isLiveContainerStatus,
  isNoisyDockerAction,
} from './resource-events.js';

describe('resource-events', () => {
  it('treats exec/attach noise as ignorable', () => {
    expect(isNoisyDockerAction('exec_start')).toBe(true);
    expect(isNoisyDockerAction('attach')).toBe(true);
    expect(isNoisyDockerAction('start')).toBe(false);
    expect(isNoisyDockerAction('health_status:unhealthy')).toBe(false);
  });

  it('strips health_status suffixes', () => {
    expect(dockerActionName('health_status:healthy')).toBe('health_status');
  });

  it('keeps paused/restarting in the live subset', () => {
    expect(isLiveContainerStatus('running')).toBe(true);
    expect(isLiveContainerStatus('paused')).toBe(true);
    expect(isLiveContainerStatus('exited')).toBe(false);
  });
});
