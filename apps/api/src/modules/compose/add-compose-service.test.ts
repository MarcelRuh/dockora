import { describe, expect, it } from 'vitest';
import { addComposeService } from './compose.service.js';

const YAML = `services:
  web:
    image: nginx
`;

describe('addComposeService', () => {
  it('appends a service with image, ports and restart policy', () => {
    const yaml = addComposeService(YAML, {
      name: 'api',
      image: 'node:22-alpine',
      ports: ['3000:3000'],
    });
    expect(yaml).toContain('image: nginx');
    expect(yaml).toContain('api:');
    expect(yaml).toContain('image: node:22-alpine');
    expect(yaml).toContain('3000:3000');
    expect(yaml).toContain('restart: unless-stopped');
  });

  it('rejects a duplicate service name', () => {
    expect(() => addComposeService(YAML, { name: 'web', image: 'caddy' })).toThrow(/already exists/);
  });

  it('rejects an invalid port mapping', () => {
    expect(() =>
      addComposeService(YAML, { name: 'api', image: 'node', ports: ['eighty'] }),
    ).toThrow(/Invalid port mapping/);
  });
});
