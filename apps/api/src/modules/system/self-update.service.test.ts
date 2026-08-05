import { describe, expect, it } from 'vitest';
import { revisionsMatch, readLocalRevision } from './self-update.service.js';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('revisionsMatch', () => {
  it('matches full SHAs', () => {
    expect(revisionsMatch('abc1234deadbeef', 'abc1234deadbeef')).toBe(true);
  });

  it('matches short vs full', () => {
    expect(revisionsMatch('abc1234', 'abc1234deadbeef000')).toBe(true);
    expect(revisionsMatch('abc1234deadbeef000', 'abc1234')).toBe(true);
  });

  it('rejects different revisions', () => {
    expect(revisionsMatch('aaaaaaaa', 'bbbbbbbb')).toBe(false);
  });
});

describe('readLocalRevision', () => {
  it('prefers env override', () => {
    expect(readLocalRevision('/nonexistent', 'deadbeef')).toBe('deadbeef');
  });

  it('reads .dockora-revision file', () => {
    const dir = join(tmpdir(), `dockora-rev-${Date.now()}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, '.dockora-revision'), 'cafeBabe1234567890\n');
    try {
      expect(readLocalRevision(dir, null)).toBe('cafeBabe1234567890');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
