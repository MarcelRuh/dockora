import { describe, expect, it } from 'vitest';
import type { ContainerSummary } from '@dockora/shared';
import {
  UNATTACHED_NETWORK,
  buildTopologyGraph,
  containerNodeId,
  groupId,
  primaryNetwork,
  sortNetworkKeys,
} from './network-topology-layout';

function ctr(
  partial: Pick<ContainerSummary, 'id' | 'name' | 'networks' | 'ports'> & {
    status?: ContainerSummary['status'];
  },
): ContainerSummary {
  return {
    image: 'x:latest',
    state: 'running',
    createdAt: '',
    labels: {},
    ...partial,
    status: partial.status ?? 'running',
  };
}

const labels = { host: 'Docker Host', network: 'Container', unattached: 'Ohne Netzwerk' };

describe('primaryNetwork', () => {
  it('prefers compose networks over bridge/host', () => {
    expect(primaryNetwork(['bridge', 'app_default'])).toBe('app_default');
    expect(primaryNetwork(['host'])).toBe('host');
    expect(primaryNetwork([])).toBe(UNATTACHED_NETWORK);
  });
});

describe('sortNetworkKeys', () => {
  it('orders custom networks first, then system, then unattached', () => {
    expect(sortNetworkKeys(['bridge', UNATTACHED_NETWORK, 'web', 'db'])).toEqual([
      'db',
      'web',
      'bridge',
      UNATTACHED_NETWORK,
    ]);
  });
});

describe('buildTopologyGraph', () => {
  it('groups containers under their primary network and uses one host edge per published container', () => {
    const graph = buildTopologyGraph(
      [
        ctr({
          id: 'a',
          name: 'web',
          networks: ['frontend'],
          ports: ['8080->80/tcp', ':::8080->80/tcp'],
        }),
        ctr({
          id: 'b',
          name: 'api',
          networks: ['frontend', 'backend'],
          ports: ['3001->3001/tcp'],
        }),
        ctr({ id: 'c', name: 'db', networks: ['backend'], ports: ['5432/tcp'] }),
      ],
      labels,
    );

    const groupNodes = graph.nodes.filter((n) => n.type === 'networkGroup');
    expect(groupNodes.map((n) => n.id).sort()).toEqual([groupId('backend'), groupId('frontend')].sort());

    expect(graph.nodes.find((n) => n.id === containerNodeId('a'))?.parentId).toBe(groupId('frontend'));
    expect(graph.nodes.find((n) => n.id === containerNodeId('b'))?.parentId).toBe(groupId('frontend'));
    expect(graph.nodes.find((n) => n.id === containerNodeId('c'))?.parentId).toBe(groupId('backend'));

    const hostEdges = graph.edges.filter((e) => e.source === 'host');
    expect(hostEdges).toHaveLength(2);
    expect(hostEdges.map((e) => e.target).sort()).toEqual([containerNodeId('a'), containerNodeId('b')].sort());

    const extra = graph.edges.filter((e) => e.source === containerNodeId('b') && e.target === groupId('backend'));
    expect(extra).toHaveLength(1);
  });

  it('puts containers without networks into the unattached group', () => {
    const graph = buildTopologyGraph([ctr({ id: 'x', name: 'lone', networks: [], ports: [] })], labels);
    expect(graph.nodes.find((n) => n.id === containerNodeId('x'))?.parentId).toBe(groupId(UNATTACHED_NETWORK));
    expect(graph.nodes.find((n) => n.id === groupId(UNATTACHED_NETWORK))?.data).toMatchObject({
      label: 'Ohne Netzwerk',
    });
  });
});
