import { describe, expect, it } from 'vitest';
import { extractComposeServiceIcons, resolveContainerIconUrl } from './container-icon';

describe('resolveContainerIconUrl', () => {
  it('prefers icon over the Arcane vendor key', () => {
    expect(
      resolveContainerIconUrl({
        'com.getarcaneapp.arcane.icon': 'https://old.example/a.png',
        icon: 'https://new.example/b.png',
      }),
    ).toBe('https://new.example/b.png');
  });

  it('falls back to Arcane when icon is missing', () => {
    expect(
      resolveContainerIconUrl({
        'com.getarcaneapp.arcane.icon': 'https://old.example/a.png',
      }),
    ).toBe('https://old.example/a.png');
  });
});

describe('extractComposeServiceIcons', () => {
  it('reads icon= list labels', () => {
    const yaml = `services:
  seerr:
    image: seerr:latest
    labels:
      - icon=https://cdn.example/seerr.png
`;
    expect(extractComposeServiceIcons(yaml)).toEqual({
      seerr: 'https://cdn.example/seerr.png',
    });
  });

  it('still reads legacy Arcane labels', () => {
    const yaml = `services:
  sonarr:
    labels:
      - com.getarcaneapp.arcane.icon=https://cdn.example/sonarr.png
`;
    expect(extractComposeServiceIcons(yaml)).toEqual({
      sonarr: 'https://cdn.example/sonarr.png',
    });
  });
});
