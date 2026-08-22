import { describe, expect, it } from 'vitest';
import {
  formatHostBinding,
  parsePortBinding,
  parsePortBindings,
  uniquePublishedPorts,
} from './parse-ports';

describe('parsePortBinding', () => {
  it('parses published host port', () => {
    expect(parsePortBinding('8080->80/tcp')).toEqual({
      raw: '8080->80/tcp',
      published: true,
      hostIp: null,
      hostPort: '8080',
      containerPort: '80',
      protocol: 'tcp',
    });
  });

  it('parses published with host IP', () => {
    expect(parsePortBinding('127.0.0.1:3001->3001/tcp')).toEqual({
      raw: '127.0.0.1:3001->3001/tcp',
      published: true,
      hostIp: '127.0.0.1',
      hostPort: '3001',
      containerPort: '3001',
      protocol: 'tcp',
    });
  });

  it('parses IPv6 all-interfaces publish', () => {
    expect(parsePortBinding(':::3000->3000/tcp')).toEqual({
      raw: ':::3000->3000/tcp',
      published: true,
      hostIp: '::',
      hostPort: '3000',
      containerPort: '3000',
      protocol: 'tcp',
    });
  });

  it('parses internal-only ports', () => {
    expect(parsePortBinding('5432/tcp')).toEqual({
      raw: '5432/tcp',
      published: false,
      hostIp: null,
      hostPort: null,
      containerPort: '5432',
      protocol: 'tcp',
    });
  });

  it('returns null for garbage', () => {
    expect(parsePortBinding('n/a')).toBeNull();
  });
});

describe('uniquePublishedPorts', () => {
  it('dedupes ipv4/ipv6 dual binds', () => {
    const all = parsePortBindings(['3000->3000/tcp', ':::3000->3000/tcp']);
    const unique = uniquePublishedPorts(all);
    expect(unique).toHaveLength(1);
    expect(formatHostBinding(unique[0]!)).toBe(':3000');
  });
});
