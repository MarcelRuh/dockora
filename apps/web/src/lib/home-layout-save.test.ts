import { describe, expect, it } from 'vitest';
import { EMPTY_HOME_LAYOUT } from './home-layout';
import { createLayoutSaveQueue } from './home-layout-save';
import type { HomeLayout } from '@dockora/shared';

function layout(name: string): HomeLayout {
  return {
    ...EMPTY_HOME_LAYOUT,
    links: [{ id: 'abc1', name, url: 'https://example.test', icon: 'https://example.test/a.png' }],
  };
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('createLayoutSaveQueue', () => {
  it('sends a newer layout after the in-flight save finishes', async () => {
    const first = deferred<number>();
    const seen: string[] = [];
    const queue = createLayoutSaveQueue({
      save: (value, revision) => {
        seen.push(value.links[0]?.name ?? '');
        if (seen.length === 1) return first.promise.then(() => revision + 1);
        return Promise.resolve(revision + 1);
      },
      reloadRevision: () => Promise.resolve(0),
      isConflict: () => false,
      onError: () => undefined,
    });
    queue.setRevision(1);
    queue.submit(layout('one'));
    queue.submit(layout('two'));
    await Promise.resolve();
    expect(seen).toEqual(['one']);
    first.resolve(2);
    await queue.settled();
    expect(seen).toEqual(['one', 'two']);
  });

  it('reports a save only after the latest layout lands', async () => {
    let saved = 0;
    const queue = createLayoutSaveQueue({
      save: (_value, revision) => Promise.resolve(revision + 1),
      reloadRevision: () => Promise.resolve(0),
      isConflict: () => false,
      onError: () => undefined,
      onSaved: () => {
        saved += 1;
      },
    });
    queue.submit(layout('done'));
    await queue.settled();
    expect(saved).toBe(1);
  });

  it('retries a stale revision with the latest layout', async () => {
    const revisions: number[] = [];
    let calls = 0;
    const queue = createLayoutSaveQueue({
      save: (_value, revision) => {
        calls += 1;
        revisions.push(revision);
        if (calls === 1) return Promise.reject(Object.assign(new Error('stale'), { status: 409 }));
        return Promise.resolve(revision + 1);
      },
      reloadRevision: () => Promise.resolve(4),
      isConflict: (error) => error instanceof Error && (error as { status?: number }).status === 409,
      onError: () => undefined,
    });
    queue.setRevision(1);
    queue.submit(layout('current'));
    await queue.settled();
    expect(revisions).toEqual([1, 4]);
  });
});
