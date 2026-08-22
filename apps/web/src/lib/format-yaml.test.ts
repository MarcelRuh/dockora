import { describe, expect, it } from 'vitest';
import { formatComposeYaml, formatEnvFile } from './format-yaml';

describe('formatComposeYaml', () => {
  it('normalizes 4-space indent to 2 spaces', () => {
    const result = formatComposeYaml(`services:
    web:
        image: nginx:alpine
        restart: unless-stopped
`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.text).toBe(`services:
  web:
    image: nginx:alpine
    restart: unless-stopped
`);
  });

  it('keeps quoted ports and comments', () => {
    const result = formatComposeYaml(`services:
  web:
    # reverse proxy
    image: nginx
    ports:
      - "18080:80"
`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.text).toContain('# reverse proxy');
    expect(result.text).toContain('"18080:80"');
    expect(result.text).toMatch(/ports:\n {6}- /);
  });

  it('converts tabs to spaces', () => {
    const result = formatComposeYaml('services:\n\tweb:\n\t\timage: nginx\n');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.text).not.toContain('\t');
    expect(result.text).toContain('  web:');
  });

  it('does not wrap long image lines', () => {
    const image =
      'ghcr.io/example/very-long-org-name/service:1.2.3-alpine-build.20260822';
    const result = formatComposeYaml(`services:\n  app:\n    image: ${image}\n`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.text).toContain(`image: ${image}`);
    expect(result.text.split('\n').some((line) => line.includes('image:') && line.includes(image))).toBe(
      true,
    );
  });

  it('returns an error for invalid YAML', () => {
    const result = formatComposeYaml('services:\n  web: [\n');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.length).toBeGreaterThan(0);
  });

  it('leaves empty input unchanged', () => {
    expect(formatComposeYaml('')).toEqual({ ok: true, text: '' });
    expect(formatComposeYaml('   \n')).toEqual({ ok: true, text: '   \n' });
  });

  it('expands flow collections into the block compose structure', () => {
    const result = formatComposeYaml(`services:
  web:
    image: nginx
    ports: ["8080:80", "443:443"]
    environment: {FOO: bar, BAZ: qux}
`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.text).toBe(`services:
  web:
    image: nginx
    ports:
      - "8080:80"
      - "443:443"
    environment:
      FOO: bar
      BAZ: qux
`);
  });

  it('re-indents the whole document and spaces compose sections', () => {
    const result = formatComposeYaml(`name: proxy-stack



services:
    web:
        image: nginx
        ports: ["8080:80"]
    db:
        image: postgres
        volumes:
        - data:/var/lib/postgresql/data
networks:
    default:
        name: foo
`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.text).toBe(`name: proxy-stack

services:
  web:
    image: nginx
    ports:
      - "8080:80"

  db:
    image: postgres
    volumes:
      - data:/var/lib/postgresql/data

networks:
  default:
    name: foo
`);
  });
});

describe('formatEnvFile', () => {
  it('trims trailing spaces and ensures a final newline', () => {
    const result = formatEnvFile('PUID=1000  \nPGID=1000');
    expect(result).toEqual({ ok: true, text: 'PUID=1000\nPGID=1000\n' });
  });

  it('keeps comments and blank lines in the middle', () => {
    const result = formatEnvFile('# app\n\nTZ=Europe/Berlin\n');
    expect(result).toEqual({ ok: true, text: '# app\n\nTZ=Europe/Berlin\n' });
  });
});
