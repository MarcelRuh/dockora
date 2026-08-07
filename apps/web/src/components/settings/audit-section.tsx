'use client';

import { useCallback, useEffect, useState } from 'react';
import { fetchAuditLogs } from '@/lib/api';
import { useLocale } from '@/i18n/locale-provider';
import { formatRelativeTime } from '@/lib/format';
import { Button, Input } from '@/components/ui/form-controls';
import { ErrorBanner, Section } from '@/components/ui/page-parts';

type AuditRow = Awaited<ReturnType<typeof fetchAuditLogs>>[number];

export function AuditSection() {
  const { t, locale } = useLocale();
  const loc = locale === 'de' ? 'de-DE' : 'en-US';
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState('');
  const [resource, setResource] = useState('');
  const [since, setSince] = useState('');
  const [until, setUntil] = useState('');

  const load = useCallback(async () => {
    try {
      setRows(
        await fetchAuditLogs({
          limit: 50,
          action: action.trim() || undefined,
          resource: resource.trim() || undefined,
          since: since ? new Date(since).toISOString() : undefined,
          until: until ? new Date(until).toISOString() : undefined,
        }),
      );
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.common.failed);
    }
  }, [action, resource, since, until, t.common.failed]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Section title={t.settings.sections.audit}>
      <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <Input
          placeholder={t.settings.audit.filterAction}
          value={action}
          onChange={(e) => setAction(e.target.value)}
        />
        <Input
          placeholder={t.settings.audit.filterResource}
          value={resource}
          onChange={(e) => setResource(e.target.value)}
        />
        <Input type="datetime-local" value={since} onChange={(e) => setSince(e.target.value)} />
        <Input type="datetime-local" value={until} onChange={(e) => setUntil(e.target.value)} />
        <Button onClick={() => void load()}>{t.common.refresh}</Button>
      </div>
      {error ? <ErrorBanner message={error} /> : null}
      <ul className="divide-y divide-dockora-border rounded-md border border-dockora-border">
        {rows.map((row) => (
          <li key={row.id} className="px-4 py-3 text-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-mono text-xs font-semibold text-dockora-accent">{row.action}</span>
              <time className="font-mono text-[11px] text-dockora-muted">
                {formatRelativeTime(row.createdAt, loc)}
              </time>
            </div>
            <p className="mt-1 font-mono text-[11px] text-dockora-muted">
              {[row.resource, row.resourceId].filter(Boolean).join(' · ') || '—'}
              {row.actorId ? ` · actor ${row.actorId.slice(0, 8)}…` : ''}
            </p>
          </li>
        ))}
        {rows.length === 0 && !error ? (
          <li className="px-4 py-3 text-sm text-dockora-muted">{t.settings.audit.empty}</li>
        ) : null}
      </ul>
    </Section>
  );
}
