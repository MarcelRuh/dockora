'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ScheduledJob } from '@dockora/shared';
import { fetchSchedulerJobs, runSchedulerJob, updateSchedulerJob } from '@/lib/api';
import { useLocale } from '@/i18n/locale-provider';
import { formatRelativeTime } from '@/lib/format';
import { Button, Input } from '@/components/ui/form-controls';
import { ErrorBanner, Section } from '@/components/ui/page-parts';

export function SchedulerSection({ canEdit }: { canEdit: boolean }) {
  const { t, locale } = useLocale();
  const loc = locale === 'de' ? 'de-DE' : 'en-US';
  const [jobs, setJobs] = useState<ScheduledJob[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [cronEdits, setCronEdits] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      const list = await fetchSchedulerJobs();
      setJobs(list);
      setCronEdits(Object.fromEntries(list.map((j) => [j.id, j.cron])));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.common.failed);
    }
  }, [t.common.failed]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = async (job: ScheduledJob) => {
    if (!canEdit) return;
    setBusy(job.id);
    try {
      await updateSchedulerJob(job.id, { enabled: !job.enabled });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t.common.failed);
    } finally {
      setBusy(null);
    }
  };

  const saveCron = async (job: ScheduledJob) => {
    if (!canEdit) return;
    const cron = cronEdits[job.id]?.trim();
    if (!cron || cron === job.cron) return;
    setBusy(job.id);
    try {
      await updateSchedulerJob(job.id, { cron });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t.common.failed);
    } finally {
      setBusy(null);
    }
  };

  const runNow = async (job: ScheduledJob) => {
    if (!canEdit) return;
    setBusy(job.id);
    try {
      await runSchedulerJob(job.id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t.common.failed);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Section title={t.settings.sections.scheduler}>
      {error ? <ErrorBanner message={error} /> : null}
      <div className="space-y-3">
        {jobs.map((job) => (
          <div
            key={job.id}
            className="flex flex-col gap-3 rounded-xl border border-dockora-border bg-dockora-surface/80 p-4 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0 space-y-1">
              <p className="font-medium">{job.type}</p>
              <p className="font-mono text-xs text-dockora-muted">
                {t.settings.scheduler.lastRun}:{' '}
                {job.lastRunAt ? formatRelativeTime(job.lastRunAt, loc) : '—'} ·{' '}
                {t.settings.scheduler.nextRun}:{' '}
                {job.nextRunAt ? formatRelativeTime(job.nextRunAt, loc) : '—'}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                className="w-40 font-mono text-xs"
                value={cronEdits[job.id] ?? job.cron}
                disabled={!canEdit || busy === job.id}
                onChange={(e) => setCronEdits((m) => ({ ...m, [job.id]: e.target.value }))}
              />
              {canEdit ? (
                <>
                  <Button disabled={busy === job.id} onClick={() => void saveCron(job)}>
                    {t.settings.scheduler.saveCron}
                  </Button>
                  <Button disabled={busy === job.id} onClick={() => void toggle(job)}>
                    {job.enabled ? t.settings.scheduler.disable : t.settings.scheduler.enable}
                  </Button>
                  <Button
                    variant="primary"
                    disabled={busy === job.id}
                    onClick={() => void runNow(job)}
                  >
                    {t.settings.scheduler.runNow}
                  </Button>
                </>
              ) : (
                <span className="text-xs text-dockora-muted">
                  {job.enabled ? t.settings.scheduler.enabled : t.settings.scheduler.disabled}
                </span>
              )}
            </div>
          </div>
        ))}
        {jobs.length === 0 ? (
          <p className="text-sm text-dockora-muted">{t.settings.scheduler.empty}</p>
        ) : null}
      </div>
    </Section>
  );
}
