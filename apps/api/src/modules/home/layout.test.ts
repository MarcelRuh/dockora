import { describe, expect, it } from 'vitest';
import { emptyHomeLayout, expectedHomeRevision, normalizeHomeLayout, readHomeLayoutState } from './layout.js';

describe('normalizeHomeLayout', () => {
  it('returns an empty layout for junk input', () => {
    expect(normalizeHomeLayout(null)).toEqual(emptyHomeLayout());
    expect(normalizeHomeLayout('nope')).toEqual(emptyHomeLayout());
  });

  it('keeps known dock keys and drops the rest', () => {
    expect(
      normalizeHomeLayout({
        appOrder: ['settings', 'containers', 'settings', 'nope', 'terminal'],
      }).appOrder,
    ).toEqual(['settings', 'containers', 'terminal']);
  });

  it('keeps http addresses and an explicit empty override', () => {
    expect(
      normalizeHomeLayout({
        appUrls: {
          plex: 'http://plex.local',
          bad: 'javascript:alert(1)',
          cleared: '',
          spaced: 'http://bad host',
        },
      }).appUrls,
    ).toEqual({
      plex: 'http://plex.local',
      cleared: '',
    });
  });

  it('keeps valid links and drops incomplete ones', () => {
    const links = normalizeHomeLayout({
      links: [
        { id: 'abc1', name: 'Beispiel', url: 'https://example.test', icon: 'https://example.test/icon.png' },
        { id: 'x', name: 'kurz', url: 'https://example.test', icon: 'https://example.test/icon.png' },
        { id: 'abc2', name: 'Datei', url: 'file:///tmp/a', icon: 'https://example.test/icon.png' },
      ],
    }).links;
    expect(links).toEqual([
      { id: 'abc1', name: 'Beispiel', url: 'https://example.test', icon: 'https://example.test/icon.png' },
    ]);
  });

  it('keeps named departments and only assignments that point at them', () => {
    const layout = normalizeHomeLayout({
      departments: [
        { id: 'media1', name: 'Medien' },
        { id: 'x', name: 'kurz' },
        { id: 'bad id', name: 'Leer' },
      ],
      appDepartments: { plex: 'media1', sonarr: 'missing', radarr: 'media1' },
    });
    expect(layout.departments).toEqual([{ id: 'media1', name: 'Medien', x: 0, y: 0, width: 440, height: 300 }]);
    expect(layout.appDepartments).toEqual({ plex: 'media1', radarr: 'media1' });
  });

  it('keeps a custom department box and clamps it', () => {
    const layout = normalizeHomeLayout({
      departments: [{ id: 'box001', name: 'Filme', x: 12.6, y: -8, width: 4000, height: 40 }],
    });
    expect(layout.departments[0]).toMatchObject({ x: 13, y: 0, width: 1600, height: 160 });
  });

  it('keeps fractional department boxes inside the canvas', () => {
    const layout = normalizeHomeLayout({
      departments: [{ id: 'box002', name: 'Filme', x: 0.25, y: 12, width: 0.9, height: 280 }],
    });
    expect(layout.departments[0]).toMatchObject({ x: 0.25, y: 12, width: 0.75, height: 280 });
  });

  it('ignores a revision field on the layout body', () => {
    expect(normalizeHomeLayout({ revision: 4, appOrder: ['settings'] }).appOrder).toEqual(['settings']);
    expect(expectedHomeRevision({ revision: 4, appOrder: ['settings'] })).toBe(4);
    expect(expectedHomeRevision({ revision: 1.5 })).toBeNull();
    expect(expectedHomeRevision({ appOrder: [] })).toBeNull();
  });

  it('reads an older layout without a revision as revision 0', () => {
    const state = readHomeLayoutState(JSON.stringify({ appOrder: ['logs'] }), null);
    expect(state.stored).toBe(true);
    expect(state.revision).toBe(0);
    expect(state.layout.appOrder).toEqual(['logs']);
    expect(readHomeLayoutState(null, '3')).toEqual({
      stored: false,
      revision: 0,
      layout: emptyHomeLayout(),
    });
  });

  it('preserves hidden widgets', () => {
    expect(normalizeHomeLayout({ widgets: { system: false, storage: true } }).widgets).toEqual({
      system: false,
      storage: true,
      network: true,
    });
  });
});
