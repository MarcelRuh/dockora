'use client';

import { useMemo, useState } from 'react';
import type { ContainerSummary } from '@dockora/shared';
import Link from 'next/link';
import { collectPublishedPorts, filterPublishedPorts } from '@/lib/published-ports';
import { containerStatusTone } from '@/lib/status';
import { Input, Select } from '@/components/ui/form-controls';
import { StatusBadge } from '@/components/ui/page-parts';
import { useLocale } from '@/i18n/locale-provider';

export interface PortCardLabels {
  title: string;
  empty: string;
  host: string;
  container: string;
  protocol: string;
  status: string;
  name: string;
  filterPlaceholder: string;
  filterNone: string;
}

export function PortCards({
  containers,
  labels,
}: {
  containers: ContainerSummary[];
  labels: PortCardLabels;
}) {
  const { t } = useLocale();
  const [query, setQuery] = useState('');
  const [protocol, setProtocol] = useState('all');
  const [status, setStatus] = useState('all');
  const cards = useMemo(() => collectPublishedPorts(containers), [containers]);
  const protocols = useMemo(
    () => [...new Set(cards.map((c) => c.protocol))].sort((a, b) => a.localeCompare(b)),
    [cards],
  );
  const statuses = useMemo(
    () => [...new Set(cards.map((c) => c.status))].sort((a, b) => a.localeCompare(b)),
    [cards],
  );
  const filtered = useMemo(
    () => filterPublishedPorts(cards, { query, protocol, status }),
    [cards, query, protocol, status],
  );
  const filtering = query.trim() !== '' || protocol !== 'all' || status !== 'all';

  return (
    <section className="space-y-2">
      <div className="flex items-baseline gap-2">
        <h2 className="font-display text-base font-bold">{labels.title}</h2>
        {cards.length > 0 ? (
          <p className="font-mono text-[10px] tabular-nums text-dockora-muted">
            {filtering ? `${filtered.length}/${cards.length}` : cards.length}
          </p>
        ) : null}
      </div>
      {cards.length === 0 ? (
        <p className="text-sm text-dockora-muted">{labels.empty}</p>
      ) : (
        <div className="overflow-hidden rounded-md border border-dockora-border bg-dockora-surface/70">
          <div className="grid grid-cols-1 gap-2 border-b border-dockora-border p-2 sm:grid-cols-[minmax(0,1fr)_8rem_9rem]">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={labels.filterPlaceholder}
              aria-label={t.common.search}
              className="h-8 w-full min-w-0 text-xs"
            />
            <Select
              value={protocol}
              onChange={(e) => setProtocol(e.target.value)}
              aria-label={labels.protocol}
              className="h-8 w-full min-w-0 text-xs"
            >
              <option value="all">{t.common.all}</option>
              {protocols.map((p) => (
                <option key={p} value={p}>
                  {p.toUpperCase()}
                </option>
              ))}
            </Select>
            <Select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              aria-label={labels.status}
              className="h-8 w-full min-w-0 text-xs"
            >
              <option value="all">{t.common.all}</option>
              {statuses.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </div>
          {filtered.length === 0 ? (
            <p className="px-2.5 py-3 text-sm text-dockora-muted">{labels.filterNone}</p>
          ) : (
            <div className="max-h-[9.5rem] overflow-auto">
              <table className="w-full text-left text-xs">
            <thead className="sticky top-0 z-10 bg-[#0a0a12]/95">
              <tr className="border-b border-dockora-border text-[10px] font-display font-semibold uppercase tracking-[0.14em] text-dockora-muted">
                <th className="whitespace-nowrap px-2.5 py-1.5">{labels.host}</th>
                <th className="whitespace-nowrap px-2.5 py-1.5">{labels.container}</th>
                <th className="whitespace-nowrap px-2.5 py-1.5">{labels.protocol}</th>
                <th className="px-2.5 py-1.5">{labels.name}</th>
                <th className="whitespace-nowrap px-2.5 py-1.5">{labels.status}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((card) => (
                <tr key={card.key} className="border-b border-dockora-border/50 last:border-0 hover:bg-white/[0.03]">
                  <td className="px-2.5 py-1">
                    <Link
                      href={`/containers/${encodeURIComponent(card.containerId)}`}
                      className="font-mono text-[13px] font-semibold tabular-nums text-dockora-accent hover:underline"
                    >
                      {card.hostLabel}
                    </Link>
                  </td>
                  <td className="px-2.5 py-1 font-mono tabular-nums text-dockora-text">{card.containerPort}</td>
                  <td className="px-2.5 py-1 font-mono uppercase text-dockora-muted">{card.protocol}</td>
                  <td className="max-w-[14rem] truncate px-2.5 py-1">
                    <Link
                      href={`/containers/${encodeURIComponent(card.containerId)}`}
                      className="text-dockora-text hover:text-dockora-accent"
                    >
                      {card.containerName}
                    </Link>
                  </td>
                  <td className="px-2.5 py-1">
                    <StatusBadge status={containerStatusTone(card.status)} label={card.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
