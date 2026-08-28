'use client';

import { useMemo, useCallback, useEffect, type MouseEvent } from 'react';
import { useRouter } from 'next/navigation';
import type { ContainerSummary } from '@dockora/shared';
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  Position,
  useNodesState,
  useEdgesState,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import {
  buildTopologyGraph,
  type ContainerNodeData,
  type HostNodeData,
  type NetworkGroupData,
} from '@/lib/network-topology-layout';
import { cn } from '@/lib/utils';

export interface TopologyLabels {
  title: string;
  empty: string;
  host: string;
  network: string;
  published: string;
  unattached: string;
}

function HostNode({ data }: NodeProps<Node<HostNodeData>>) {
  return (
    <div className="min-w-[132px] rounded-md border border-dockora-accent/50 bg-dockora-accentSoft px-3 py-2.5">
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-dockora-accent">Host</p>
      <p className="mt-0.5 font-display text-sm font-bold">{data.label}</p>
      <Handle type="source" position={Position.Right} className="!bg-dockora-accent" />
    </div>
  );
}

function NetworkGroupNode({ data }: NodeProps<Node<NetworkGroupData>>) {
  return (
    <>
      <Handle type="target" position={Position.Left} className="!bg-dockora-muted" />
      <div className="h-full w-full rounded-md border border-dockora-border bg-dockora-surface2/35">
        <p className="truncate border-b border-dockora-border/70 px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-dockora-muted">
          {data.label}
          <span className="ml-2 font-normal normal-case tracking-normal opacity-80">{data.count}</span>
        </p>
      </div>
    </>
  );
}

function ContainerNode({ data }: NodeProps<Node<ContainerNodeData>>) {
  const running = data.status === 'running';
  return (
    <div
      className={cn(
        'w-[228px] cursor-pointer rounded-md border bg-dockora-surface px-2.5 py-1.5',
        running ? 'border-dockora-success/40' : 'border-dockora-border',
      )}
    >
      <Handle type="target" position={Position.Left} className="!bg-dockora-muted" />
      <p className="truncate text-[13px] font-medium leading-tight">{data.label}</p>
      <div className="mt-1 flex items-center justify-between gap-2">
        <p
          className={cn(
            'font-mono text-[10px] uppercase tracking-wide',
            running ? 'text-dockora-success' : 'text-dockora-muted',
          )}
        >
          {data.status}
        </p>
        {data.ports.length > 0 ? (
          <p className="truncate font-mono text-[10px] text-dockora-accent">{data.ports.join(' ')}</p>
        ) : null}
      </div>
      <Handle type="source" position={Position.Right} className="!bg-dockora-muted" />
    </div>
  );
}

const nodeTypes = {
  host: HostNode,
  container: ContainerNode,
  networkGroup: NetworkGroupNode,
};

export function NetworkTopology({
  containers,
  labels,
}: {
  containers: ContainerSummary[];
  labels: TopologyLabels;
}) {
  const router = useRouter();
  const graph = useMemo(
    () =>
      buildTopologyGraph(containers, {
        host: labels.host,
        network: labels.network,
        unattached: labels.unattached,
      }),
    [containers, labels.host, labels.network, labels.unattached],
  );
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
      <section className="space-y-2">
        <h2 className="font-display text-lg font-bold">{labels.title}</h2>
        <p className="text-sm text-dockora-muted">{labels.empty}</p>
      </section>
    );
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-display text-lg font-bold">{labels.title}</h2>
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-dockora-muted">
          {labels.published}
        </p>
      </div>
      <div className="h-[min(68vh,740px)] overflow-hidden rounded-md border border-dockora-border bg-dockora-bg/60">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          onNodeClick={onNodeClick}
          fitView
          fitViewOptions={{ padding: 0.18 }}
          minZoom={0.35}
          maxZoom={1.5}
          colorMode="dark"
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={20} size={1} color="var(--dockora-border)" />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
    </section>
  );
}
