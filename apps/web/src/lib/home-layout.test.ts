import { describe, expect, it } from 'vitest';
import {
  clampDepartmentBox,
  completeHomeLayout,
  departmentPixelSpan,
  departmentVisualBox,
  fitDepartmentLayout,
  EMPTY_HOME_LAYOUT,
  homeLayoutHasData,
  normalizeStoredDepartments,
  pickHomeLayout,
  withDockDefaults,
} from './home-layout';

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

  it('fills departments missing from an older layout', () => {
    const layout = completeHomeLayout({ appOrder: ['settings'] });
    expect(layout.departments).toEqual([]);
    expect(layout.appDepartments).toEqual({});
    expect(layout.appOrder).toEqual(['settings']);
    expect(normalizeStoredDepartments([{ id: 'abc1', name: 'Alt' }])).toEqual([
      { id: 'abc1', name: 'Alt', x: 0, y: 0, width: 440, height: 300 },
    ]);
    expect(
      homeLayoutHasData({
        ...EMPTY_HOME_LAYOUT,
        departments: [{ id: 'media1', name: 'Medien', x: 0, y: 0, width: 440, height: 300 }],
      }),
    ).toBe(true);
  });

  it('scales a wide pixel layout down to the current canvas', () => {
    const wide = { id: 'wide1', name: 'Breit', x: 1400, y: 0, width: 800, height: 300 };
    expect(departmentPixelSpan([wide])).toBe(2200);
    expect(departmentVisualBox(wide, 1100, 2200)).toMatchObject({ x: 700, width: 400 });
    expect(departmentVisualBox({ x: 0.2, y: 0, width: 0.5, height: 300 }, 1100, 0)).toMatchObject({
      x: 220,
      width: 550,
    });
  });

  it('stores a dragged box as a fraction that stays inside the canvas', () => {
    expect(clampDepartmentBox({ x: 100, y: 40, width: 400, height: 300 }, 1000)).toEqual({
      x: 0.1,
      y: 40,
      width: 0.4,
      height: 300,
    });
    expect(clampDepartmentBox({ x: 900, y: 40, width: 700, height: 300 }, 1200)).toEqual({
      x: 0.75,
      y: 40,
      width: 0.25,
      height: 300,
    });
  });

  it('grows a department to its apps and keeps the row beside it', () => {
    const fitted = fitDepartmentLayout(
      [
        { id: 'left', x: 0, y: 0, width: 400, height: 300 },
        { id: 'right', x: 420, y: 0, width: 400, height: 300 },
        { id: 'below', x: 0, y: 316, width: 400, height: 300 },
      ],
      { left: 520, right: 360 },
    );
    expect(fitted.find((item) => item.id === 'left')).toMatchObject({ y: 0, height: 520 });
    expect(fitted.find((item) => item.id === 'right')).toMatchObject({ y: 0, height: 360 });
    expect(fitted.find((item) => item.id === 'below')).toMatchObject({ y: 536, height: 300 });
  });

  it('treats the default widgets as empty', () => {
    expect(homeLayoutHasData(EMPTY_HOME_LAYOUT)).toBe(false);
    expect(homeLayoutHasData({ ...EMPTY_HOME_LAYOUT, widgets: { system: false, storage: true, network: true } })).toBe(
      true,
    );
  });
});
