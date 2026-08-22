import { describe, expect, it } from 'vitest';
import { applyDockerUpdateProgress, parseDockerUpdateProgressLine } from './docker-host-progress.js';

describe('parseDockerUpdateProgressLine', () => {
  it('reads explicit markers', () => {
    expect(parseDockerUpdateProgressLine('==> [18%] aptUpdate – Paketliste')).toEqual({
      percent: 18,
      step: 'aptUpdate',
      detail: '==> [18%] aptUpdate – Paketliste',
    });
  });

  it('ignores unrelated output', () => {
    expect(parseDockerUpdateProgressLine('Get:1 http://deb.debian.org')).toBeNull();
  });
});

describe('applyDockerUpdateProgress', () => {
  it('never moves backwards', () => {
    const first = applyDockerUpdateProgress(null, '==> [40%] install');
    const second = applyDockerUpdateProgress(first, '==> [18%] aptUpdate');
    expect(second?.percent).toBe(40);
    expect(second?.step).toBe('install');
  });
});
