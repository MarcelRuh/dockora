import { describe, expect, it } from 'vitest';
import type { PublishedPortCard } from './published-ports';
import { filterPublishedPorts } from './published-ports';

function row(partial: Partial<PublishedPortCard> & Pick<PublishedPortCard, 'key'>): PublishedPortCard {
  return {
    containerId: 'abc',
    containerName: 'web',
    status: 'running',
    hostLabel: ':8080',
    containerPort: '80',
    protocol: 'tcp',
    raw: '8080->80/tcp',
    ...partial,
  };
}

const rows: PublishedPortCard[] = [
  row({ key: '1', hostLabel: ':8080', containerPort: '80', containerName: 'homarr', protocol: 'tcp', status: 'running' }),
  row({
    key: '2',
    hostLabel: '127.0.0.1:3001',
    containerPort: '3001',
    containerName: 'dockora-api',
    protocol: 'tcp',
    status: 'running',
  }),
  row({
    key: '3',
    hostLabel: ':53',
    containerPort: '53',
    containerName: 'dns',
    protocol: 'udp',
    status: 'exited',
    raw: '53->53/udp',
  }),
];

describe('filterPublishedPorts', () => {
  it('matches any column via the text query', () => {
    expect(filterPublishedPorts(rows, { query: 'homarr', protocol: 'all', status: 'all' }).map((r) => r.key)).toEqual([
      '1',
    ]);
    expect(filterPublishedPorts(rows, { query: '3001', protocol: 'all', status: 'all' }).map((r) => r.key)).toEqual([
      '2',
    ]);
    expect(filterPublishedPorts(rows, { query: 'udp', protocol: 'all', status: 'all' }).map((r) => r.key)).toEqual([
      '3',
    ]);
    expect(filterPublishedPorts(rows, { query: 'exited', protocol: 'all', status: 'all' }).map((r) => r.key)).toEqual([
      '3',
    ]);
  });

  it('combines text, protocol and status filters', () => {
    expect(
      filterPublishedPorts(rows, { query: '', protocol: 'tcp', status: 'running' }).map((r) => r.key),
    ).toEqual(['1', '2']);
    expect(filterPublishedPorts(rows, { query: 'dns', protocol: 'udp', status: 'running' })).toEqual([]);
    expect(
      filterPublishedPorts(rows, { query: '53', protocol: 'udp', status: 'exited' }).map((r) => r.key),
    ).toEqual(['3']);
  });
});
