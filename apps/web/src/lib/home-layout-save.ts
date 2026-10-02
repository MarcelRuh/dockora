import type { HomeLayout } from '@dockora/shared';

export function createLayoutSaveQueue(deps: {
  save: (layout: HomeLayout, revision: number) => Promise<number>;
  reloadRevision: () => Promise<number>;
  isConflict: (error: unknown) => boolean;
  onError: (kind: 'conflict' | 'failed') => void;
}) {
  let revision = 0;
  let latest: HomeLayout | null = null;
  let inflight = false;
  let rerun = false;
  let tail: Promise<void> = Promise.resolve();

  async function run(): Promise<void> {
    if (inflight) {
      rerun = true;
      return;
    }
    inflight = true;
    let conflicts = 0;
    try {
      while (latest) {
        const snapshot = latest;
        rerun = false;
        try {
          revision = await deps.save(snapshot, revision);
          conflicts = 0;
        } catch (error) {
          if (deps.isConflict(error) && conflicts < 2) {
            conflicts += 1;
            revision = await deps.reloadRevision();
            rerun = true;
          } else {
            deps.onError(deps.isConflict(error) ? 'conflict' : 'failed');
            break;
          }
        }
        if (!rerun && latest === snapshot) break;
      }
    } finally {
      inflight = false;
      if (rerun && latest) void run();
    }
  }

  return {
    setRevision(value: number) {
      revision = value;
    },
    submit(layout: HomeLayout) {
      latest = layout;
      const pending = run();
      tail = tail.then(() => pending);
    },
    settled() {
      return tail;
    },
  };
}
