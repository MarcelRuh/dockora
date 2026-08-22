import { describe, expect, it } from 'vitest';
import {
  revisionsMatch,
  readLocalRevision,
  isSelfUpdateAvailable,
} from './self-update.service.js';
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

  it('prefers deployed .dockora-revision over git HEAD', () => {
    const dir = join(tmpdir(), `dockora-git-rev-${Date.now()}`);
    mkdirSync(join(dir, '.git', 'refs', 'heads'), { recursive: true });
    writeFileSync(join(dir, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    writeFileSync(
      join(dir, '.git', 'refs', 'heads', 'main'),
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n',
    );
    writeFileSync(join(dir, '.dockora-revision'), 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\n');
    try {
      expect(readLocalRevision(dir, null)).toBe('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('isSelfUpdateAvailable', () => {
  it('is true when remote SHA differs from deployed', () => {
    expect(
      isSelfUpdateAvailable({
        deployedRevision: 'aaaaaaaa',
        remoteRevision: 'bbbbbbbb',
        runningVersion: '1.5.3',
        sourceVersion: '1.5.3',
      }),
    ).toBe(true);
  });

  it('is true when running version lags source even if SHAs match', () => {
    expect(
      isSelfUpdateAvailable({
        deployedRevision: 'aaaaaaaaaaaaaaaa',
        remoteRevision: 'aaaaaaaaaaaaaaaa',
        runningVersion: '1.5.3',
        sourceVersion: '1.5.3.1',
      }),
    ).toBe(true);
  });

  it('is false when deployed SHA and running version match remote/source', () => {
    expect(
      isSelfUpdateAvailable({
        deployedRevision: 'aaaaaaaaaaaaaaaa',
        remoteRevision: 'aaaaaaaaaaaaaaaa',
        runningVersion: '1.5.3.2',
        sourceVersion: '1.5.3.2',
      }),
    ).toBe(false);
  });
});
