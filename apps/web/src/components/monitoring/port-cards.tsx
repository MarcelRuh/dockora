'use client';

import type { ContainerSummary } from '@dockora/shared';
import Link from 'next/link';
import { formatHostBinding, parsePortBindings } from '@/lib/parse-ports';
import { containerStatusTone } from '@/lib/status';
import { StatusBadge } from '@/components/ui/page-parts';

export interface PortCardLabels {
  title: string;
  empty: string;
  host: string;
  container: string;
  protocol: string;
  status: string;
}

export interface PublishedPortCard {
  key: string;
  containerId: string;
  containerName: string;
  status: ContainerSummary['status'];
  hostLabel: string;
  containerPort: string;
  protocol: string;
  raw: string;
}

export function collectPublishedPorts(containers: ContainerSummary[]): PublishedPortCard[] {
  const cards: PublishedPortCard[] = [];
  for (const c of containers) {
    for (const port of parsePortBindings(c.ports).filter((p) => p.published)) {
      cards.push({
        key: `${c.id}-${port.raw}`,
        containerId: c.id,
        containerName: c.name,
        status: c.status,
        hostLabel: formatHostBinding(port),
        containerPort: port.containerPort,
        protocol: port.protocol,
        raw: port.raw,
      });
    }
  }
  cards.sort((a, b) => {
    const ap = Number.parseInt(a.hostLabel.replace(/\D/g, ''), 10) || 0;
    const bp = Number.parseInt(b.hostLabel.replace(/\D/g, ''), 10) || 0;
    if (ap !== bp) return ap - bp;
    return a.containerName.localeCompare(b.containerName);
  });
  return cards;
}

export function PortCards({
  containers,
  labels,
}: {
  containers: ContainerSummary[];
  labels: PortCardLabels;
}) {
  const cards = collectPublishedPorts(containers);

  return (
    <section className="space-y-3">
      <h2 className="font-display text-lg font-bold">{labels.title}</h2>
      {cards.length === 0 ? (
        <p className="text-sm text-dockora-muted">{labels.empty}</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {cards.map((card) => (
            <Link
              key={card.key}
              href={`/containers/${encodeURIComponent(card.containerId)}`}
              className="block space-y-3 rounded-2xl border border-dockora-border bg-dockora-surface/80 p-4 transition hover:border-dockora-accent/50 hover:bg-dockora-surface"
            >
              <div className="flex items-start justify-between gap-2">
                <p className="font-mono text-2xl font-bold tabular-nums text-dockora-accent">
                  {card.hostLabel}
                </p>
                <StatusBadge status={containerStatusTone(card.status)} label={card.status} />
              </div>
              <p className="truncate text-sm font-medium">{card.containerName}</p>
              <dl className="grid grid-cols-2 gap-2 font-mono text-[11px] text-dockora-muted">
                <div>
                  <dt className="uppercase tracking-wide">{labels.container}</dt>
                  <dd className="mt-0.5 text-dockora-text">{card.containerPort}</dd>
                </div>
                <div>
                  <dt className="uppercase tracking-wide">{labels.protocol}</dt>
                  <dd className="mt-0.5 uppercase text-dockora-text">{card.protocol}</dd>
                </div>
              </dl>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
