import { describe, expect, it } from 'vitest';
import { removeComposeService } from './compose.service.js';

const YAML = `services:
  web:
    image: nginx
    depends_on:
      - db
  api:
    image: node
    depends_on:
      db:
        condition: service_healthy
      web:
        condition: service_started
  db:
    image: postgres
`;

describe('removeComposeService', () => {
  it('drops one service and leaves the others', () => {
    const { yaml, remaining } = removeComposeService(YAML, 'db');
    expect(remaining.sort()).toEqual(['api', 'web']);
    expect(yaml).not.toMatch(/^\s{2}db:/m);
    expect(yaml).toContain('image: nginx');
    expect(yaml).toContain('image: node');
    expect(yaml).not.toContain('postgres');
  });

  it('strips depends_on entries that point at the removed service', () => {
    const { yaml } = removeComposeService(YAML, 'web');
    expect(yaml).toContain('db:');
    expect(yaml).not.toMatch(/depends_on:[\s\S]*web:/);
    expect(yaml).toContain('condition: service_healthy');
  });

  it('removes an empty depends_on list', () => {
    const { yaml } = removeComposeService(YAML, 'db');
    expect(yaml).toMatch(/web:\n {4}image: nginx\n {2}api:/);
    expect(yaml).not.toMatch(/image: nginx\n {4}depends_on/);
  });

  it('reports no remaining services for a single-service file', () => {
    const { remaining } = removeComposeService(
      'services:\n  only:\n    image: alpine\n',
      'only',
    );
    expect(remaining).toEqual([]);
  });

  it('rejects an unknown service', () => {
    expect(() => removeComposeService(YAML, 'missing')).toThrow(/not found/);
  });
});
