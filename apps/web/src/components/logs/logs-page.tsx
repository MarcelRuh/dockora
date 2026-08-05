'use client';

import { useCallback, useEffect, useState } from 'react';
import type { LogEntry, LogLevel } from '@dockora/shared';
import { fetchLogs } from '@/lib/api';
import { useLocale } from '@/i18n/locale-provider';
import { logLevelTone } from '@/lib/status';
import { Button, Input, Select } from '@/components/ui/form-controls';
import {
  DataTable,
  EmptyState,
  ErrorBanner,
  LoadingState,
  PageHeader,
  StatusBadge,
} from '@/components/ui/page-parts';

export function LogsPageView() {
  const { t, locale } = useLocale();
  const loc = locale === 'de' ? 'de-DE' : 'en-US';
  const [items, setItems] = useState<LogEntry[]>([]);
  const [container, setContainer] = useState('');
  const [level, setLevel] = useState<LogLevel | ''>('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchLogs({
        container: container || undefined,
        level: level || undefined,
        q: search || undefined,
        limit: 500,
      });
      setItems(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.logs.loadError);
    } finally {
      setLoading(false);
    }
  }, [container, level, search, t.logs.loadError]);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = items.map((entry) => [
    new Date(entry.timestamp).toLocaleString(loc),
    entry.containerName ?? entry.containerId ?? '—',
    <StatusBadge key={`lv-${entry.id}`} status={logLevelTone(entry.level)} label={entry.level} />,
    <span key={`msg-${entry.id}`} className="font-mono text-xs whitespace-pre-wrap break-all">
      {entry.message}
    </span>,
  ]);

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <PageHeader title={t.logs.title} subtitle={t.logs.subtitle} />

      <div className="flex flex-wrap gap-3">
        <Input
          placeholder={t.logs.container}
          value={container}
          onChange={(e) => setContainer(e.target.value)}
          className="max-w-xs"
        />
        <Select value={level} onChange={(e) => setLevel(e.target.value as LogLevel | '')}>
          <option value="">{t.common.all}</option>
          <option value="debug">debug</option>
          <option value="info">info</option>
          <option value="warn">warn</option>
          <option value="error">error</option>
        </Select>
        <Input
          placeholder={t.logs.search}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        <Button variant="primary" onClick={() => void load()}>
          {t.common.filter}
        </Button>
        <Button onClick={() => void load()}>{t.common.refresh}</Button>
      </div>

      {error ? <ErrorBanner message={error} /> : null}
      {loading ? <LoadingState message={t.common.loading} /> : null}

      {!loading ? (
        <DataTable
          headers={[t.logs.timestamp, t.logs.container, t.logs.level, t.logs.message]}
          rows={rows}
          empty={<EmptyState message={t.logs.empty} />}
        />
      ) : null}
    </div>
  );
}
