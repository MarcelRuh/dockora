import { describe, expect, it } from 'vitest';
import { EMPTY_HOME_LAYOUT, homeLayoutHasData, pickHomeLayout, withDockDefaults } from './home-layout';

const local = {
  ...EMPTY_HOME_LAYOUT,
  links: [{ id: 'abc1', name: 'Beispiel', url: 'https://example.test', icon: 'https://example.test/a.png' }],
};

describe('pickHomeLayout', () => {
  it('uploads a local layout when the server has nothing yet', () => {
    expect(
      pickHomeLayout({
        remoteStored: false,
        remote: EMPTY_HOME_LAYOUT,
        local,
        dirty: false,
        canEdit: true,
      }),
    ).toEqual({ layout: local, upload: true });
  });

  it('keeps the stored server layout', () => {
    const remote = { ...EMPTY_HOME_LAYOUT, appOrder: ['settings'] };
    expect(
      pickHomeLayout({
        remoteStored: true,
        remote,
        local,
        dirty: false,
        canEdit: true,
      }),
    ).toEqual({ layout: remote, upload: false });
  });

  it('does not upload a viewer change', () => {
    expect(
      pickHomeLayout({
        remoteStored: false,
        remote: EMPTY_HOME_LAYOUT,
        local,
        dirty: true,
        canEdit: false,
      }).upload,
    ).toBe(false);
  });
});

describe('home layout helpers', () => {
  it('appends dock keys that are missing from a saved order', () => {
    const order = withDockDefaults(['settings']);
    expect(order[0]).toBe('settings');
    expect(order).toContain('containers');
    expect(order).toHaveLength(12);
  });

  it('treats the default widgets as empty', () => {
    expect(homeLayoutHasData(EMPTY_HOME_LAYOUT)).toBe(false);
    expect(homeLayoutHasData({ ...EMPTY_HOME_LAYOUT, widgets: { system: false, storage: true, network: true } })).toBe(
      true,
    );
  });
});
