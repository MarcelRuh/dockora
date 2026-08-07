'use client';

import { useMemo, useCallback, useEffect, type MouseEvent } from 'react';
import { useRouter } from 'next/navigation';
import type { ContainerSummary } from '@dockora/shared';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  MarkerType,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type NodeProps,
} from '@xyflow/react';
import { parsePortBindings, uniquePublishedPorts } from '@/lib/parse-ports';
import { cn } from '@/lib/utils';
import { useTheme } from '@/components/theme-provider';

export interface TopologyLabels {
  title: string;
  empty: string;
  host: string;
  network: string;
  published: string;
}

type HostNodeData = { label: string };
type ContainerNodeData = {
  label: string;
  status: string;
  containerId: string;
  ports: string[];
};
type NetworkNodeData = { label: string; count: string };

type TopologyNode = Node<HostNodeData | ContainerNodeData | NetworkNodeData>;

function HostNode({ data }: NodeProps<Node<HostNodeData>>) {
  return (
    <div className="min-w-[140px] rounded-2xl border border-dockora-accent/50 bg-dockora-accent-soft px-4 py-3 shadow-sm">
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-dockora-accent">Host</p>
      <p className="mt-1 font-display text-sm font-bold">{data.label}</p>
      <Handle type="source" position={Position.Right} className="!bg-dockora-accent" />
    </div>
  );
}

function ContainerNode({ data }: NodeProps<Node<ContainerNodeData>>) {
  const running = data.status === 'running';
  return (
    <div
      className={cn(
        'min-w-[170px] cursor-pointer rounded-2xl border bg-dockora-surface px-4 py-3 shadow-sm',
        running ? 'border-dockora-success/40' : 'border-dockora-border',
      )}
    >
      <Handle type="target" position={Position.Left} className="!bg-dockora-muted" />
      <p className="truncate text-sm font-medium">{data.label}</p>
      <p
        className={cn(
          'mt-1 font-mono text-[10px] uppercase tracking-wide',
          running ? 'text-dockora-success' : 'text-dockora-muted',
        )}
      >
        {data.status}
      </p>
      {data.ports.length > 0 ? (
        <p className="mt-2 font-mono text-[10px] text-dockora-muted">{data.ports.join(' · ')}</p>
      ) : null}
      <Handle type="source" position={Position.Right} className="!bg-dockora-muted" />
    </div>
  );
}

function NetworkNode({ data }: NodeProps<Node<NetworkNodeData>>) {
  return (
    <div className="min-w-[140px] rounded-2xl border border-dockora-border bg-dockora-surface-2/80 px-4 py-3 shadow-sm">
      <Handle type="target" position={Position.Left} className="!bg-dockora-muted" />
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-dockora-muted">Network</p>
      <p className="mt-1 truncate font-mono text-sm font-semibold">{data.label}</p>
      <p className="mt-1 font-mono text-[10px] text-dockora-muted">{data.count}</p>
    </div>
  );
}

const nodeTypes = {
  host: HostNode,
  container: ContainerNode,
  network: NetworkNode,
};

function buildGraph(
  containers: ContainerSummary[],
  labels: TopologyLabels,
): { nodes: TopologyNode[]; edges: Edge[] } {
  const nodes: TopologyNode[] = [];
  const edges: Edge[] = [];

  nodes.push({
    id: 'host',
    type: 'host',
    position: { x: 0, y: 160 },
    data: { label: labels.host },
    draggable: false,
  });

  const networkNames = [...new Set(containers.flatMap((c) => c.networks))].sort();
  const networkY = (index: number, total: number) => {
    const spacing = 100;
    const height = Math.max((total - 1) * spacing, 0);
    return 40 + index * spacing - height / 2 + 160;
  };

  networkNames.forEach((name, index) => {
    const count = containers.filter((c) => c.networks.includes(name)).length;
    nodes.push({
      id: `net-${name}`,
      type: 'network',
      position: { x: 640, y: networkY(index, networkNames.length) },
      data: {
        label: name,
        count: `${count} · ${labels.network}`,
      },
      draggable: true,
    });
  });

  const containerY = (index: number, total: number) => {
    const spacing = 110;
    const height = Math.max((total - 1) * spacing, 0);
    return 20 + index * spacing - height / 2 + 160;
  };

  containers.forEach((c, index) => {
    const published = uniquePublishedPorts(parsePortBindings(c.ports)).map((p) => p.raw);

    nodes.push({
      id: `ctr-${c.id}`,
      type: 'container',
      position: { x: 280, y: containerY(index, containers.length) },
      data: {
        label: c.name,
        status: c.status,
        containerId: c.id,
        ports: published,
      },
      draggable: true,
    });

    for (const port of published) {
      edges.push({
        id: `host-${c.id}-${port}`,
        source: 'host',
        target: `ctr-${c.id}`,
        label: port,
        markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
        style: { stroke: 'var(--dockora-accent)' },
        labelStyle: { fill: 'var(--dockora-muted)', fontSize: 10 },
        labelBgStyle: { fill: 'var(--dockora-surface)', fillOpacity: 0.9 },
      });
    }

    for (const net of c.networks) {
      edges.push({
        id: `ctr-${c.id}-net-${net}`,
        source: `ctr-${c.id}`,
        target: `net-${net}`,
        markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
        style: { stroke: 'var(--dockora-border)' },
      });
    }
  });

  return { nodes, edges };
}

export function NetworkTopology({
  containers,
  labels,
}: {
  containers: ContainerSummary[];
  labels: TopologyLabels;
}) {
  const router = useRouter();
  const { theme } = useTheme();
  const graph = useMemo(() => buildGraph(containers, labels), [containers, labels]);
  const [nodes, setNodes, onNodesChange] = useNodesState(graph.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(graph.edges);

  useEffect(() => {
    setNodes(graph.nodes);
    setEdges(graph.edges);
  }, [graph, setNodes, setEdges]);

  const onNodeClick = useCallback(
    (_: MouseEvent, node: Node) => {
      if (node.type !== 'container') return;
      const id = (node.data as ContainerNodeData).containerId;
      if (id) router.push(`/containers/${encodeURIComponent(id)}`);
    },
    [router],
  );

  if (containers.length === 0) {
    return (
      <section className="space-y-3">
        <h2 className="font-display text-lg font-bold">{labels.title}</h2>
        <p className="text-sm text-dockora-muted">{labels.empty}</p>
      </section>
    );
  }

  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-display text-lg font-bold">{labels.title}</h2>
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-dockora-muted">
          {labels.published}
        </p>
      </div>
      <div className="h-[420px] overflow-hidden rounded-2xl border border-dockora-border bg-dockora-bg/60">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          onNodeClick={onNodeClick}
          fitView
          minZoom={0.4}
          maxZoom={1.6}
          colorMode={theme === 'dark' ? 'dark' : 'light'}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={18} size={1} color="var(--dockora-border)" />
          <Controls showInteractive={false} />
          <MiniMap
            pannable
            zoomable
            bgColor="var(--dockora-surface)"
            maskColor={
              theme === 'dark' ? 'rgba(10, 13, 20, 0.65)' : 'rgba(238, 241, 246, 0.65)'
            }
            nodeColor={() => 'var(--dockora-accent)'}
            nodeStrokeColor={() => 'transparent'}
          />
        </ReactFlow>
      </div>
    </section>
  );
}
