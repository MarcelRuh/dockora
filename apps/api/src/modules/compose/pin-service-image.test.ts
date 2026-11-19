import { describe, expect, it } from 'vitest';
import { pinServiceImage } from './compose.service.js';

describe('pinServiceImage', () => {
  it('pins image for a named service', () => {
    const yaml = `services:
  web:
    image: nginx:alpine
    ports:
      - "80:80"
  db:
    image: postgres:16
`;
    const out = pinServiceImage(yaml, 'web', 'nginx@sha256:abc123');
    expect(out).toContain('nginx@sha256:abc123');
    expect(out).toContain('postgres:16');
    expect(out).not.toMatch(/web:[\s\S]*image: nginx:alpine/);
  });

  it('throws when service is missing', () => {
    expect(() => pinServiceImage('services:\n  web:\n    image: nginx\n', 'missing', 'x')).toThrow(
      /not found/,
    );
  });
});

describe('buildImageOverride', () => {
  it('only overrides the image of one service', async () => {
    const { buildImageOverride } = await import('./compose.service.js');
    const YAML = (await import('yaml')).default;
    const out = YAML.parse(buildImageOverride('nginx-proxy-manager', 'jc21/nginx-proxy-manager@sha256:abc'));
    expect(out).toEqual({ services: { 'nginx-proxy-manager': { image: 'jc21/nginx-proxy-manager@sha256:abc' } } });
  });
});
