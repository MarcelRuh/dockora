import cron, { type ScheduledTask } from 'node-cron';
import type { ScheduledJob, JobType } from '@dockora/shared';
import { prisma } from '../../infrastructure/db/prisma.js';
import { nextCronRunIso } from './next-cron-run.js';

export type JobCallback = () => Promise<void>;

const DEFAULT_JOBS: Array<{ type: JobType; cron: string; preset?: string }> = [
  { type: 'update_check', cron: '0 */2 * * *', preset: 'custom' },
  { type: 'backup', cron: '0 2 * * *', preset: 'daily' },
  { type: 'cleanup', cron: '0 3 * * *', preset: 'daily' },
  { type: 'healthcheck', cron: '*/15 * * * *', preset: 'custom' },
];

export class SchedulerService {
  private readonly callbacks = new Map<JobType, JobCallback>();
  private readonly tasks = new Map<string, ScheduledTask>();
  private readonly lastErrors = new Map<string, string>();
  private readonly running = new Set<string>();
  private started = false;

  registerCallback(type: JobType, callback: JobCallback): void {
    this.callbacks.set(type, callback);
  }

  async seedDefaults(): Promise<void> {
    for (const job of DEFAULT_JOBS) {
      const existing = await prisma.scheduledJob.findFirst({ where: { type: job.type } });
      if (!existing) {
        await prisma.scheduledJob.create({
          data: {
            type: job.type,
            cron: job.cron,
            preset: job.preset,
            enabled: true,
          },
        });
      } else if (
        job.type === 'cleanup' &&
        existing.cron === '0 3 * * 0' &&
        job.cron === '0 3 * * *'
      ) {
        // Migrate legacy weekly cleanup → daily (build-cache fills quickly)
        await prisma.scheduledJob.update({
          where: { id: existing.id },
          data: { cron: job.cron, preset: job.preset },
        });
      } else if (
        job.type === 'healthcheck' &&
        (existing.cron === '*/5 * * * *' || existing.cron === '*/5 * * *')
      ) {
        // Less frequent healthchecks → lower Docker df / CPU load
        await prisma.scheduledJob.update({
          where: { id: existing.id },
          data: { cron: job.cron, preset: job.preset },
        });
      } else if (job.type === 'update_check' && existing.cron === '0 * * * *') {
        // Hourly registry checks are heavy under GHCR rate limits
        await prisma.scheduledJob.update({
          where: { id: existing.id },
          data: { cron: job.cron, preset: job.preset },
        });
      }
    }
  }

  async listJobs(): Promise<ScheduledJob[]> {
    const rows = await prisma.scheduledJob.findMany({ orderBy: { type: 'asc' } });
    return rows.map((row) => mapRow(row, this.lastErrors.get(row.id)));
  }

  async updateJob(
    id: string,
    patch: { enabled?: boolean; cron?: string },
  ): Promise<ScheduledJob> {
    const row = await prisma.scheduledJob.update({
      where: { id },
      data: {
        enabled: patch.enabled,
        cron: patch.cron,
      },
    });

    if (this.started) {
      this.rescheduleJob(row.id, row.cron, row.enabled, row.type as JobType);
    }

    return mapRow(row, this.lastErrors.get(row.id));
  }

  async runJob(id: string): Promise<{ ok: boolean; message: string }> {
    const row = await prisma.scheduledJob.findUnique({ where: { id } });
    if (!row) {
      return { ok: false, message: 'Job not found' };
    }

    const callback = this.callbacks.get(row.type as JobType);
    if (!callback) {
      return { ok: false, message: `No callback registered for ${row.type}` };
    }

    if (this.running.has(id)) {
      return { ok: false, message: 'Job already running' };
    }
    this.running.add(id);

    try {
      await callback();
      this.lastErrors.delete(id);
      await prisma.scheduledJob.update({
        where: { id },
        data: { lastRunAt: new Date() },
      });
      return { ok: true, message: 'Job executed' };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.lastErrors.set(id, message);
      return {
        ok: false,
        message,
      };
    } finally {
      this.running.delete(id);
    }
  }

  async start(): Promise<void> {
    if (this.started) return;
    await this.seedDefaults();
    this.started = true;

    const jobs = await prisma.scheduledJob.findMany();
    for (const job of jobs) {
      if (job.enabled) {
        this.scheduleJob(job.id, job.cron, job.type as JobType);
      }
    }
  }

  stop(): void {
    for (const task of this.tasks.values()) {
      task.stop();
    }
    this.tasks.clear();
    this.started = false;
  }

  private scheduleJob(id: string, expression: string, _type: JobType): void {
    if (!cron.validate(expression)) {
      return;
    }

    const existing = this.tasks.get(id);
    existing?.stop();

    const task = cron.schedule(expression, () => {
      void this.runJob(id).catch(() => undefined);
    });

    this.tasks.set(id, task);
  }

  private rescheduleJob(id: string, expression: string, enabled: boolean, type: JobType): void {
    const existing = this.tasks.get(id);
    existing?.stop();
    this.tasks.delete(id);

    if (enabled) {
      this.scheduleJob(id, expression, type);
    }
  }
}

function mapRow(
  row: {
    id: string;
    type: string;
    cron: string;
    preset: string | null;
    enabled: boolean;
    lastRunAt: Date | null;
  },
  lastError?: string,
): ScheduledJob {
  return {
    id: row.id,
    type: row.type as JobType,
    cron: row.cron,
    preset: (row.preset ?? undefined) as ScheduledJob['preset'],
    enabled: row.enabled,
    lastRunAt: row.lastRunAt?.toISOString(),
    nextRunAt: cron.validate(row.cron) ? nextCronRunIso(row.cron) : undefined,
    lastError,
  };
}
