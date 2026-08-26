import { describe, expect, it } from 'vitest';
import { lintComposeYaml, lintEnvFile, previewComposeInterpolation } from './compose-lint';

describe('lintComposeYaml', () => {
  it('flags parse errors and missing services', () => {
    const broken = lintComposeYaml('services:\n  web: [\n');
    expect(broken.some((d) => d.severity === 'error')).toBe(true);

    const empty = lintComposeYaml('name: foo\n');
    expect(empty.some((d) => d.message.includes('services'))).toBe(true);
  });

  it('warns when a service has no image or build', () => {
    const result = lintComposeYaml(`services:
  web:
    restart: unless-stopped
`);
    expect(result.some((d) => d.message.includes('neither image nor build'))).toBe(true);
  });

  it('warns about unset interpolation', () => {
    const result = lintComposeYaml(
      `services:
  web:
    image: nginx
    ports:
      - "\${WEB_PORT}:80"
`,
      'FOO=1\n',
    );
    expect(result.some((d) => d.message.includes('WEB_PORT'))).toBe(true);
  });
});

describe('previewComposeInterpolation', () => {
  it('substitutes env values and reports missing keys', () => {
    const result = previewComposeInterpolation(
      'image: ${IMAGE}\nports: "${PORT:-8080}:80"\nextra: $MISSING\n',
      'IMAGE=nginx\n',
    );
    expect(result.preview).toContain('image: nginx');
    expect(result.preview).toContain('ports: "8080:80"');
    expect(result.missing).toEqual(['MISSING']);
  });
});

describe('lintEnvFile', () => {
  it('flags duplicate keys', () => {
    const result = lintEnvFile('FOO=1\nFOO=2\n');
    expect(result.some((d) => d.message.includes('Duplicate'))).toBe(true);
  });
});
