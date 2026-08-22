import { describe, expect, it, vi } from 'vitest';
import type { UpdateCheckResult } from '@dockora/shared';
import { notifyUpdatesAvailable, notifyUpdatesInstalled } from './notify-updates.js';

function row(partial: Partial<UpdateCheckResult> & Pick<UpdateCheckResult, 'containerName'>): UpdateCheckResult {
  return {
    containerId: partial.containerId ?? 'id',
    containerName: partial.containerName,
    image: partial.image ?? 'example/img:latest',
    currentDigest: null,
    remoteDigest: null,
    updateAvailable: partial.updateAvailable ?? false,
    registry: 'ghcr',
    currentTag: partial.currentTag ?? 'latest',
    checkedAt: new Date().toISOString(),
    error: partial.error,
  };
}

describe('notifyUpdatesAvailable', () => {
  it('skips when nothing is available', async () => {
    const notify = vi.fn();
    await notifyUpdatesAvailable({ notify } as never, [
      row({ containerName: 'a', updateAvailable: false }),
      row({ containerName: 'b', updateAvailable: true, error: 'rate limited' }),
    ]);
    expect(notify).not.toHaveBeenCalled();
  });

  it('notifies with container names', async () => {
    const notify = vi.fn();
    await notifyUpdatesAvailable({ notify } as never, [
      row({ containerName: '/plex', updateAvailable: true, image: 'lscr.io/linuxserver/plex:latest' }),
    ]);
    expect(notify).toHaveBeenCalledOnce();
    const call = notify.mock.calls[0]!;
    expect(call[0]).toBe('update.available');
    expect(call[1]).toBe('Update verfügbar');
    expect(call[2]).toContain('plex');
    expect(call[4].containers).toEqual(['plex']);
  });
});

describe('notifyUpdatesInstalled', () => {
  it('notifies success for installed containers', async () => {
    const notify = vi.fn();
    await notifyUpdatesInstalled({ notify } as never, [
      row({ containerName: 'radarr', updateAvailable: true }),
    ]);
    const call = notify.mock.calls[0]!;
    expect(call[0]).toBe('update.installed');
    expect(call[4].containers).toEqual(['radarr']);
  });
});
