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
      reloadState: () => Promise.resolve({ layout: layout('remote'), revision: 0 }),
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
      reloadState: () => Promise.resolve({ layout: layout('remote'), revision: 0 }),
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

  it('adopts the remote layout on conflict instead of overwriting it', async () => {
    const names: string[] = [];
    let reloaded: string | null = null;
    let error: string | null = null;
    const queue = createLayoutSaveQueue({
      save: (value) => {
        names.push(value.links[0]?.name ?? '');
        return Promise.reject(Object.assign(new Error('stale'), { status: 409 }));
      },
      reloadState: () => Promise.resolve({ layout: layout('remote'), revision: 9 }),
      isConflict: (err) => err instanceof Error && (err as { status?: number }).status === 409,
      onError: (kind) => {
        error = kind;
      },
      onReloaded: (value) => {
        reloaded = value.links[0]?.name ?? null;
      },
    });
    queue.setRevision(1);
    queue.submit(layout('local'));
    await queue.settled();
    expect(names).toEqual(['local']);
    expect(reloaded).toBe('remote');
    expect(error).toBe('conflict');
  });
});
