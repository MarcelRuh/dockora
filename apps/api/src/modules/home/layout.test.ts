import { describe, expect, it } from 'vitest';
import { emptyHomeLayout, normalizeHomeLayout } from './layout.js';

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
    expect(layout.departments).toEqual([{ id: 'media1', name: 'Medien', column: 'wide' }]);
    expect(layout.appDepartments).toEqual({ plex: 'media1', radarr: 'media1' });
  });

  it('keeps a left or right column and treats anything else as full width', () => {
    const layout = normalizeHomeLayout({
      departments: [
        { id: 'left01', name: 'Links', column: 'left' },
        { id: 'right1', name: 'Rechts', column: 'right' },
        { id: 'other1', name: 'Mitte', column: 'top' },
      ],
    });
    expect(layout.departments.map((item) => item.column)).toEqual(['left', 'right', 'wide']);
  });

  it('preserves hidden widgets', () => {
    expect(normalizeHomeLayout({ widgets: { system: false, storage: true } }).widgets).toEqual({
      system: false,
      storage: true,
      network: true,
    });
  });
});
