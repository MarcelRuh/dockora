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

  it('preserves hidden widgets', () => {
    expect(normalizeHomeLayout({ widgets: { system: false, storage: true } }).widgets).toEqual({
      system: false,
      storage: true,
      network: true,
    });
  });
});
