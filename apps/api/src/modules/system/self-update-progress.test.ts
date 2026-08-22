import { describe, expect, it } from 'vitest';
import {
  mergeProgress,
  parseProgressFile,
  parseUpdaterLogs,
} from './self-update-progress.js';

describe('parseProgressFile', () => {
  it('reads percent/step/detail', () => {
    const parsed = parseProgressFile('percent=42\nstep=buildApi\ndetail=API-Image wird gebaut\n');
    expect(parsed).toEqual({ percent: 42, step: 'buildApi', detail: 'API-Image wird gebaut' });
  });

  it('rejects incomplete files', () => {
    expect(parseProgressFile('percent=10\n')).toBeNull();
  });
});

describe('parseUpdaterLogs', () => {
  it('tracks the latest rebuild phase', () => {
    const logs = [
      '==> Dockora self-update',
      '==> Resolving remote revision',
      '    remote=abc',
      '==> Git sync complete',
      '==> Rebuilding stack (docker compose up -d --build)',
      ' Image dockora-api Building',
      ' Image dockora-web Building',
      ' ✓ Compiled successfully in 9.3s',
      ' Container dockora-api  Started',
      ' Container dockora-api  Healthy',
      '==> Refreshing proxy',
      '    wrote .dockora-revision',
      '==> Done. Dockora should come back shortly.',
    ].join('\n');
    const parsed = parseUpdaterLogs(logs);
    expect(parsed?.percent).toBe(100);
    expect(parsed?.step).toBe('done');
  });

  it('stays on api build while that layer is active', () => {
    const parsed = parseUpdaterLogs(
      '==> Rebuilding stack\n Image dockora-api Building\n#12 RUN apt-get update\n',
    );
    expect(parsed?.step).toBe('buildApi');
    expect(parsed?.percent).toBe(38);
  });

  it('reads explicit percent lines from the apply script', () => {
    const parsed = parseUpdaterLogs(
      '==> Dockora self-update\n==> [38%] buildApi – API-Image wird gebaut\n==> [72%] export – Images werden exportiert\n',
    );
    expect(parsed?.percent).toBe(72);
    expect(parsed?.step).toBe('export');
  });
});

describe('mergeProgress', () => {
  it('prefers the higher percent', () => {
    const merged = mergeProgress(
      { percent: 22, step: 'sync', detail: null },
      { percent: 52, step: 'buildWeb', detail: null },
    );
    expect(merged?.step).toBe('buildWeb');
  });

  it('ignores a leftover 100% done file during a new run', () => {
    const merged = mergeProgress(
      { percent: 100, step: 'done', detail: 'Update abgeschlossen' },
      { percent: 28, step: 'build', detail: 'Stack-Rebuild startet' },
    );
    expect(merged?.percent).toBe(28);
    expect(merged?.step).toBe('build');
  });
});
