'use client';

import { useCallback, useEffect, useState } from 'react';
import type { MonitoringSnapshot } from '@dockora/shared';
import { fetchMonitoring } from '@/lib/api';
import { useLocale } from '@/i18n/locale-provider';
import { formatPercent, formatRelativeTime } from '@/lib/format';
import { containerStatusTone } from '@/lib/status';
import { Button } from '@/components/ui/form-controls';
import {
  DataTable,
  EmptyState,
  ErrorBanner,
  LoadingState,
  PageHeader,
  StatusBadge,
} from '@/components/ui/page-parts';
import { ProgressBar } from '@/components/ui/progress-bar';

export function MonitoringPage() {
  const { t, locale } = useLocale();
  const loc = locale === 'de' ? 'de-DE' : 'en-US';
  const [data, setData] = useState<MonitoringSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await fetchMonitoring());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.monitoring.loadError);
    } finally {
      setLoading(false);
    }
  }, [t.monitoring.loadError]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 15_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const rows =
    data?.containers.map((c) => [
      c.name,
      <StatusBadge key={`st-${c.id}`} status={containerStatusTone(c.status)} label={c.status} />,
      c.alert ? (
        <span key={`a-${c.id}`} className="text-sm text-dockora-danger">
          {c.alert}
        </span>
      ) : (
        '—'
      ),
    ]) ?? [];

  return (
    <div className="space-y-8 animate-in fade-in">
      <PageHeader
        title={t.monitoring.title}
        subtitle={t.monitoring.subtitle}
        actions={
          <Button variant="primary" onClick={() => void load()}>
            {t.common.refresh}
          </Button>
        }
      />

      {error ? <ErrorBanner message={error} /> : null}
      {loading && !data ? <LoadingState message={t.common.loading} /> : null}

      {data ? (
        <>
          <div className="flex flex-wrap gap-3 text-sm text-dockora-muted">
            <span>
              Docker:{' '}
              <strong className={data.dockerOnline ? 'text-dockora-success' : 'text-dockora-danger'}>
                {data.dockerOnline ? t.monitoring.online : t.monitoring.offline}
              </strong>
            </span>
            <span>
              {t.monitoring.updated}: {formatRelativeTime(data.timestamp, loc)}
            </span>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {[
              { label: t.monitoring.cpu, value: data.host.cpuPercent },
              { label: t.monitoring.memory, value: data.host.memoryPercent },
              { label: t.monitoring.disk, value: data.host.diskPercent },
              {
                label: t.monitoring.buildCache,
                value: data.host.buildCacheBytes,
                format: (v: number | null) => {
                  if (v == null) return '—';
                  const gb = v / 1024 ** 3;
                  if (gb >= 1) return `${new Intl.NumberFormat(loc, { maximumFractionDigits: 1 }).format(gb)} GB`;
                  const mb = v / 1024 ** 2;
                  return `${new Intl.NumberFormat(loc, { maximumFractionDigits: 0 }).format(mb)} MB`;
                },
              },
              {
                label: t.monitoring.temp,
                value: data.host.temperatureC,
                format: (v: number | null) =>
                  v == null ? '—' : `${new Intl.NumberFormat(loc).format(v)} °C`,
              },
            ].map((item) => (
              <div
                key={item.label}
                className="space-y-3 rounded-md border border-dockora-border bg-dockora-surface/80 p-4"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-sm text-dockora-muted">{item.label}</p>
                  <p className="font-mono text-xl font-bold tabular-nums">
                    {'format' in item && item.format
                      ? item.format(item.value)
                      : formatPercent(item.value as number | null, loc)}
                  </p>
                </div>
                {'format' in item ? null : <ProgressBar value={item.value as number | null} />}
              </div>
            ))}
          </div>

          <section className="space-y-3">
            <h2 className="font-display text-lg font-bold">{t.monitoring.alerts}</h2>
            {data.alerts.length === 0 ? (
              <p className="text-sm text-dockora-muted">{t.monitoring.noAlerts}</p>
            ) : (
              <ul className="space-y-2">
                {data.alerts.map((alert) => (
                  <li
                    key={alert}
                    className="rounded-md border border-dockora-warning/40 bg-dockora-warning/10 px-4 py-2 text-sm text-dockora-warning"
                  >
                    {alert}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="space-y-3">
            <h2 className="font-display text-lg font-bold">{t.monitoring.containers}</h2>
            <DataTable
              headers={[t.common.name, t.common.status, t.monitoring.alert]}
              rows={rows}
              empty={<EmptyState message={t.monitoring.emptyContainers} />}
            />
          </section>
        </>
      ) : null}
    </div>
  );
}
