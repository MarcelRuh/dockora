import type { HomeLayout } from '@dockora/shared';

export function createLayoutSaveQueue(deps: {
  save: (layout: HomeLayout, revision: number) => Promise<number>;
  /** Load the remote layout after a 409 so local edits do not overwrite another operator. */
  reloadState: () => Promise<{ layout: HomeLayout; revision: number }>;
  isConflict: (error: unknown) => boolean;
  onError: (kind: 'conflict' | 'failed') => void;
  onReloaded?: (layout: HomeLayout) => void;
  onSaved?: () => void;
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
    try {
      while (latest) {
        const snapshot = latest;
        rerun = false;
        try {
          revision = await deps.save(snapshot, revision);
        } catch (error) {
          if (deps.isConflict(error)) {
            const remote = await deps.reloadState();
            revision = remote.revision;
            latest = remote.layout;
            deps.onReloaded?.(remote.layout);
            deps.onError('conflict');
            break;
          }
          deps.onError('failed');
          break;
        }
        if (!rerun && latest === snapshot) {
          deps.onSaved?.();
          break;
        }
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
