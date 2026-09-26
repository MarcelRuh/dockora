import { describe, expect, it } from 'vitest';
import { setComposeServiceIcon, setComposeServiceUrl } from './compose-icon-yaml';

const YAML = `services:
  seerr:
    image: seerr:latest
    restart: unless-stopped
  sonarr:
    image: sonarr:latest
    labels:
      - com.getarcaneapp.arcane.icon=https://old.example/sonarr.png
`;

describe('setComposeServiceIcon', () => {
  it('inserts labels when missing', () => {
    const next = setComposeServiceIcon(YAML, 'seerr', 'https://cdn.example/seerr.png');
    expect(next).toContain('  seerr:\n    labels:\n      - icon=https://cdn.example/seerr.png');
  });

  it('replaces an existing Arcane icon label', () => {
    const next = setComposeServiceIcon(YAML, 'sonarr', 'https://cdn.example/sonarr.png');
    expect(next).toContain('- icon=https://cdn.example/sonarr.png');
    expect(next).not.toContain('com.getarcaneapp.arcane.icon');
  });
});

describe('setComposeServiceUrl', () => {
  it('adds a url label without removing the icon', () => {
    const next = setComposeServiceUrl(YAML, 'sonarr', 'http://192.168.1.10:8989');
    expect(next).toContain('- url=http://192.168.1.10:8989');
    expect(next).toContain('com.getarcaneapp.arcane.icon');
  });

  it('rejects a value that is not http(s)', () => {
    expect(() => setComposeServiceUrl(YAML, 'sonarr', '8989')).toThrow(/http/);
  });
});
