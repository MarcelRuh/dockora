import type { Edge, Node } from '@xyflow/react';
import { MarkerType } from '@xyflow/react';
import type { ContainerSummary } from '@dockora/shared';
import { parsePortBindings, uniquePublishedPorts } from './parse-ports';

export const SYSTEM_NETWORKS = new Set(['bridge', 'host', 'none', 'ingress']);
export const UNATTACHED_NETWORK = '__unattached__';

const HOST_X = 0;
const GROUP_X = 280;
const GROUP_W = 248;
const GROUP_PAD_X = 10;
const GROUP_HEADER_H = 30;
const GROUP_PAD_BOTTOM = 10;
const CTR_H = 62;
const CTR_GAP = 8;
const GROUP_GAP = 28;
const HOST_H = 64;

export type HostNodeData = { label: string };
export type ContainerNodeData = {
  label: string;
  status: string;
  containerId: string;
  ports: string[];
};
export type NetworkGroupData = { label: string; count: string };

export type TopologyNode = Node<HostNodeData | ContainerNodeData | NetworkGroupData>;

export interface TopologyLayoutLabels {
  host: string;
  network: string;
  unattached: string;
}

export function primaryNetwork(networks: string[]): string {
  const custom = networks.find((name) => !SYSTEM_NETWORKS.has(name));
  return custom ?? networks[0] ?? UNATTACHED_NETWORK;
}

export function sortNetworkKeys(keys: string[]): string[] {
  return [...keys].sort((a, b) => {
    const attachedA = a === UNATTACHED_NETWORK ? 2 : SYSTEM_NETWORKS.has(a) ? 1 : 0;
    const attachedB = b === UNATTACHED_NETWORK ? 2 : SYSTEM_NETWORKS.has(b) ? 1 : 0;
    if (attachedA !== attachedB) return attachedA - attachedB;
    return a.localeCompare(b);
  });
}

export function groupId(network: string): string {
  return `grp:${network}`;
}

export function containerNodeId(containerId: string): string {
  return `ctr:${containerId}`;
}

function displayNetworkName(network: string, labels: TopologyLayoutLabels): string {
  return network === UNATTACHED_NETWORK ? labels.unattached : network;
}

export function buildTopologyGraph(
  containers: ContainerSummary[],
  labels: TopologyLayoutLabels,
): { nodes: TopologyNode[]; edges: Edge[] } {
  const nodes: TopologyNode[] = [];
  const edges: Edge[] = [];

  const byNetwork = new Map<string, ContainerSummary[]>();
  for (const container of containers) {
    const key = primaryNetwork(container.networks);
    const list = byNetwork.get(key);
    if (list) list.push(container);
    else byNetwork.set(key, [container]);
  }

  for (const list of byNetwork.values()) {
    list.sort((a, b) => a.name.localeCompare(b.name));
  }

  const networkKeys = sortNetworkKeys([...byNetwork.keys()]);

  let y = 0;

  for (const network of networkKeys) {
    const members = byNetwork.get(network) ?? [];
    const innerH =
      members.length === 0
        ? CTR_H
        : members.length * CTR_H + Math.max(0, members.length - 1) * CTR_GAP;
    const groupH = GROUP_HEADER_H + innerH + GROUP_PAD_BOTTOM;
    const gid = groupId(network);

    nodes.push({
      id: gid,
      type: 'networkGroup',
      position: { x: GROUP_X, y },
      data: {
        label: displayNetworkName(network, labels),
        count: `${members.length} · ${labels.network}`,
      },
      style: { width: GROUP_W, height: groupH },
      draggable: false,
    });

    members.forEach((container, index) => {
      const published = uniquePublishedPorts(parsePortBindings(container.ports)).map((p) =>
        p.hostPort ? `:${p.hostPort}` : p.raw,
      );
      nodes.push({
        id: containerNodeId(container.id),
        type: 'container',
        parentId: gid,
        extent: 'parent',
        position: {
          x: GROUP_PAD_X,
          y: GROUP_HEADER_H + index * (CTR_H + CTR_GAP),
        },
        data: {
          label: container.name,
          status: container.status,
          containerId: container.id,
          ports: published,
        },
        draggable: false,
      });
    });

    y += groupH + GROUP_GAP;
  }

  const totalH = Math.max(y - GROUP_GAP, HOST_H);
  const hostY = Math.max(0, totalH / 2 - HOST_H / 2);

  nodes.unshift({
    id: 'host',
    type: 'host',
    position: { x: HOST_X, y: hostY },
    data: { label: labels.host },
    draggable: false,
  });

  for (const container of containers) {
    const published = uniquePublishedPorts(parsePortBindings(container.ports));
    if (published.length > 0) {
      const portLabel = published
        .map((p) => (p.hostPort ? `:${p.hostPort}` : p.raw))
        .slice(0, 4)
        .join('  ');
      edges.push({
        id: `host-${container.id}`,
        source: 'host',
        target: containerNodeId(container.id),
        label: portLabel,
        markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
        style: { stroke: 'var(--dockora-accent)', strokeWidth: 1.5 },
        labelStyle: { fill: 'var(--dockora-muted)', fontSize: 10 },
        labelBgStyle: { fill: 'var(--dockora-surface)', fillOpacity: 0.92 },
      });
    }

    const primary = primaryNetwork(container.networks);
    for (const network of container.networks) {
      if (network === primary) continue;
      if (!byNetwork.has(network)) continue;
      edges.push({
        id: `ctr-${container.id}-net-${network}`,
        source: containerNodeId(container.id),
        target: groupId(network),
        markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12 },
        style: { stroke: 'var(--dockora-border)', strokeDasharray: '4 3' },
      });
    }
  }

  return { nodes, edges };
}
