'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { ContainerDetails, ContainerStatsSnapshot } from '@dockora/shared';
import {
  containerAction,
  fetchContainer,
  fetchContainerLogs,
  fetchContainerStats,
} from '@/lib/api';
import { useLocale } from '@/i18n/locale-provider';
import { useAuth } from '@/components/auth/auth-provider';
import { canOperate } from '@/lib/roles';
import { openEventSource } from '@/lib/sse';
import { useDockerLiveReload } from '@/hooks/use-docker-live-reload';
import { containerStatusTone } from '@/lib/status';
import { formatBytes, formatPercent } from '@/lib/format';
import { Button, Input } from '@/components/ui/form-controls';
import {
  AccentPanel,
  ErrorBanner,
  KeyValueGrid,
  LoadingState,
  LogViewer,
  PageHeader,
  Section,
  StatusBadge,
  TabBar,
} from '@/components/ui/page-parts';
import { ProgressBar } from '@/components/ui/progress-bar';
import { ServiceIcon } from '@/components/ui/service-icon';
import { resolveContainerIconUrl } from '@/lib/container-icon';

const ContainerTerminal = dynamic(
  () => import('@/components/terminal/container-terminal').then((m) => m.ContainerTerminal),
  { ssr: false, loading: () => <p className="text-sm text-dockora-muted">…</p> },
);

type Tab = 'overview' | 'stats' | 'logs' | 'terminal';

export function ContainerDetailPage({ id }: { id: string }) {
  const { t, locale } = useLocale();
  const { authEnabled, user } = useAuth();
  const canOps = canOperate(user?.role, authEnabled);
  const loc = locale === 'de' ? 'de-DE' : 'en-US';
  const [tab, setTab] = useState<Tab>('overview');
  const [container, setContainer] = useState<ContainerDetails | null>(null);
  const [stats, setStats] = useState<ContainerStatsSnapshot | null>(null);
  const [logs, setLogs] = useState('');
  const [tail, setTail] = useState(200);
  const [liveLogs, setLiveLogs] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadContainer = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    setError(null);
    try {
      const data = await fetchContainer(id);
      setContainer(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.containers.notFound);
      setContainer(null);
    } finally {
      if (!opts?.silent) setLoading(false);
    }
  }, [id, t.containers.notFound]);

  useEffect(() => {
    void loadContainer();
  }, [loadContainer]);

  useDockerLiveReload(() => void loadContainer({ silent: true }), 60_000);

  useEffect(() => {
    if (tab !== 'stats') return;
    let active = true;

    const poll = async () => {
      try {
        const s = await fetchContainerStats(id);
        if (active) setStats(s);
      } catch {
        // ignore transient stats errors
      }
    };

    void poll();
    const timer = window.setInterval(() => void poll(), 8000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [tab, id]);

  const loadLogs = useCallback(async () => {
    try {
      const text = await fetchContainerLogs(id, tail);
      setLogs(text);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.common.failed);
    }
  }, [id, tail, t.common.failed]);

  useEffect(() => {
    if (tab !== 'logs') return;
    void loadLogs();
  }, [tab, loadLogs]);

  useEffect(() => {
    if (tab !== 'logs' || !liveLogs) return;

    let es: EventSource | null = null;
    let raf = 0;
    const pending: string[] = [];

    const flush = () => {
      raf = 0;
      if (pending.length === 0) return;
      const batch = pending.splice(0).join('\n');
      setLogs((prev) => {
        const next = prev ? `${prev}\n${batch}` : batch;
        const lines = next.split('\n');
        return lines.length > 4000 ? lines.slice(-3000).join('\n') : next;
      });
    };

    try {
      es = openEventSource(
        `/api/v1/containers/${encodeURIComponent(id)}/logs/stream?tail=${tail}`,
      );
      es.onmessage = (event) => {
        try {
          pending.push(JSON.parse(event.data) as string);
          if (!raf) raf = window.requestAnimationFrame(flush);
        } catch {
          // ignore malformed chunks
        }
      };
      es.onerror = () => {
        // keep connection; EventSource retries. Fallback poll if closed permanently.
      };
    } catch {
      const timer = window.setInterval(() => void loadLogs(), 3000);
      return () => window.clearInterval(timer);
    }

    return () => {
      if (raf) window.cancelAnimationFrame(raf);
      es?.close();
    };
  }, [tab, liveLogs, id, tail, loadLogs]);

  const runAction = async (action: 'start' | 'stop' | 'restart') => {
    setBusy(true);
    try {
      await containerAction(id, action);
      await loadContainer();
    } catch (err) {
      setError(err instanceof Error ? err.message : t.common.failed);
    } finally {
      setBusy(false);
    }
  };

  const tabs = [
    { id: 'overview', label: t.containers.tabs.overview },
    { id: 'stats', label: t.containers.tabs.stats },
    { id: 'logs', label: t.containers.tabs.logs },
    { id: 'terminal', label: t.containers.tabs.terminal },
  ];

  if (loading && !container) {
    return <LoadingState message={t.common.loading} />;
  }

  if (!container) {
    return (
      <div className="space-y-4">
        <Link href="/containers" className="dockora-link text-sm">
          ← {t.common.back}
        </Link>
        <ErrorBanner message={error ?? t.containers.notFound} />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <Link href="/containers" className="dockora-link text-sm">
        ← {t.common.back}
      </Link>

      <PageHeader
        title={container.name}
        subtitle={container.image}
        leading={
          <ServiceIcon
            url={resolveContainerIconUrl(container.labels)}
            alt={container.name}
            size="lg"
          />
        }
        actions={
          <>
            <StatusBadge
              status={containerStatusTone(container.status)}
              label={container.status}
            />
            {canOps && container.status !== 'running' ? (
              <Button variant="primary" disabled={busy} onClick={() => void runAction('start')}>
                {t.containers.start}
              </Button>
            ) : null}
            {canOps && container.status === 'running' ? (
              <Button disabled={busy} onClick={() => void runAction('stop')}>
                {t.containers.stop}
              </Button>
            ) : null}
            {canOps ? (
              <Button disabled={busy} onClick={() => void runAction('restart')}>
                {t.containers.restart}
              </Button>
            ) : null}
          </>
        }
      />

      {error ? <ErrorBanner message={error} /> : null}

      <TabBar tabs={tabs} active={tab} onChange={(v) => setTab(v as Tab)} />

      {tab === 'overview' ? (
        <Section>
          <KeyValueGrid
            items={[
              { label: 'ID', value: container.id, mono: true },
              { label: t.common.image, value: container.image, mono: true },
              { label: t.common.status, value: container.state },
              {
                label: t.containers.overview.composeProject,
                value: container.composeProject ?? '—',
              },
              {
                label: t.containers.overview.command,
                value: container.command ?? '—',
                mono: true,
              },
              {
                label: t.containers.overview.restartPolicy,
                value: container.restartPolicy ?? '—',
              },
              {
                label: t.containers.overview.ports,
                value: container.ports.join(', ') || '—',
                mono: true,
              },
              {
                label: t.containers.overview.networks,
                value: container.networks.join(', ') || '—',
              },
            ]}
          />

          <Section title={t.containers.overview.volumes} className="mt-6">
            {container.mounts.length === 0 ? (
              <p className="text-sm text-dockora-muted">—</p>
            ) : (
              <ul className="space-y-2">
                {container.mounts.map((m, i) => (
                  <li key={i} className="font-mono text-xs border-l-2 border-dockora-border pl-3">
                    {m.source} → {m.destination}
                    {m.mode ? ` (${m.mode})` : ''}
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title={t.containers.overview.labels} className="mt-6">
            {Object.keys(container.labels).length === 0 ? (
              <p className="text-sm text-dockora-muted">—</p>
            ) : (
              <dl className="grid gap-2 sm:grid-cols-2">
                {Object.entries(container.labels).map(([k, v]) => (
                  <div key={k} className="font-mono text-xs">
                    <span className="text-dockora-muted">{k}=</span>
                    {v}
                  </div>
                ))}
              </dl>
            )}
          </Section>

          <Section title={t.containers.overview.env} className="mt-6">
            {container.env.length === 0 ? (
              <p className="text-sm text-dockora-muted">—</p>
            ) : (
              <pre className="max-h-64 overflow-auto rounded border border-dockora-border bg-dockora-bg p-3 font-mono text-xs">
                {container.env.join('\n')}
              </pre>
            )}
          </Section>
        </Section>
      ) : null}

      {tab === 'stats' ? (
        <Section title={t.containers.tabs.stats}>
          <p className="text-xs text-dockora-muted">{t.containers.stats.polling}</p>
          {stats ? (
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <AccentPanel>
                <p className="text-xs text-dockora-muted">{t.containers.stats.cpu}</p>
                <p className="mt-1 font-mono text-2xl">{formatPercent(stats.cpuPercent, loc)}</p>
                <ProgressBar value={stats.cpuPercent} className="mt-2" />
              </AccentPanel>
              <AccentPanel>
                <p className="text-xs text-dockora-muted">{t.containers.stats.memory}</p>
                <p className="mt-1 font-mono text-2xl">
                  {formatPercent(stats.memoryPercent, loc)}
                </p>
                <p className="text-xs text-dockora-muted">
                  {formatBytes(stats.memoryUsageBytes, loc)} /{' '}
                  {formatBytes(stats.memoryLimitBytes, loc)}
                </p>
                <ProgressBar value={stats.memoryPercent} className="mt-2" />
              </AccentPanel>
              <AccentPanel>
                <p className="text-xs text-dockora-muted">{t.containers.stats.network}</p>
                <p className="mt-1 text-sm">
                  {t.containers.stats.rx}: {formatBytes(stats.netRxBytes, loc)}
                </p>
                <p className="text-sm">
                  {t.containers.stats.tx}: {formatBytes(stats.netTxBytes, loc)}
                </p>
              </AccentPanel>
              <AccentPanel>
                <p className="text-xs text-dockora-muted">{t.containers.stats.disk}</p>
                <p className="mt-1 text-sm">
                  {t.containers.stats.read}: {formatBytes(stats.blockReadBytes, loc)}
                </p>
                <p className="text-sm">
                  {t.containers.stats.write}: {formatBytes(stats.blockWriteBytes, loc)}
                </p>
              </AccentPanel>
            </div>
          ) : (
            <LoadingState message={t.common.loading} />
          )}
        </Section>
      ) : null}

      {tab === 'logs' ? (
        <Section title={t.containers.tabs.logs}>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm">
              {t.containers.logs.tail}
              <Input
                type="number"
                min={50}
                max={2000}
                value={tail}
                onChange={(e) => setTail(Number(e.target.value) || 200)}
                className="w-24"
              />
            </label>
            <Button onClick={() => void loadLogs()}>{t.containers.logs.fetch}</Button>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={liveLogs}
                onChange={(e) => setLiveLogs(e.target.checked)}
              />
              {t.containers.logs.live}
            </label>
          </div>
          <LogViewer content={logs} />
        </Section>
      ) : null}

      {tab === 'terminal' ? (
        <Section title={t.containers.tabs.terminal}>
          {canOps ? (
            <>
              <p className="text-sm text-dockora-muted">{t.containers.terminal.hint}</p>
              <ContainerTerminal containerId={id} />
            </>
          ) : (
            <p className="text-sm text-dockora-muted">{t.common.noPermission}</p>
          )}
        </Section>
      ) : null}
    </div>
  );
}
