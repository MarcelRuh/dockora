import { prisma } from '../../infrastructure/db/prisma.js';

export const MAX_NOTIFICATION_ROWS = 5_000;
export const MAX_AUDIT_ROWS = 20_000;

const PRUNE_COOLDOWN_MS = 60_000;
let lastPruneAt = 0;
let pruneInflight: Promise<DataRetentionResult> | null = null;

export interface DataRetentionResult {
  notificationsDeleted: number;
  auditDeleted: number;
}

export function retentionCutoff(days: number, now = new Date()): Date {
  const safeDays = Math.min(3650, Math.max(1, Math.round(days)));
  return new Date(now.getTime() - safeDays * 24 * 60 * 60 * 1000);
}

async function deleteOlderThan(
  model: { deleteMany: (args: { where: { createdAt: { lt: Date } } }) => Promise<{ count: number }> },
  cutoff: Date,
): Promise<number> {
  const result = await model.deleteMany({ where: { createdAt: { lt: cutoff } } });
  return result.count;
}

async function capTable(
  countRows: () => Promise<number>,
  maxRows: number,
  findOldest: (take: number) => Promise<Array<{ id: string }>>,
  deleteIds: (ids: string[]) => Promise<number>,
): Promise<number> {
  const count = await countRows();
  const overflow = count - maxRows;
  if (overflow <= 0) return 0;
  const rows = await findOldest(overflow);
  if (rows.length === 0) return 0;
  return deleteIds(rows.map((row) => row.id));
}

async function pruneNow(
  notificationDays: number,
  auditDays: number,
): Promise<DataRetentionResult> {
  const notificationCutoff = retentionCutoff(notificationDays);
  const auditCutoff = retentionCutoff(auditDays);

  const [byAgeNotifications, byAgeAudit] = await Promise.all([
    deleteOlderThan(prisma.notification, notificationCutoff),
    deleteOlderThan(prisma.auditLog, auditCutoff),
  ]);

  const [capNotifications, capAudit] = await Promise.all([
    capTable(
      () => prisma.notification.count(),
      MAX_NOTIFICATION_ROWS,
      (take) =>
        prisma.notification.findMany({
          orderBy: { createdAt: 'asc' },
          take,
          select: { id: true },
        }),
      async (ids) => {
        const result = await prisma.notification.deleteMany({ where: { id: { in: ids } } });
        return result.count;
      },
    ),
    capTable(
      () => prisma.auditLog.count(),
      MAX_AUDIT_ROWS,
      (take) =>
        prisma.auditLog.findMany({
          orderBy: { createdAt: 'asc' },
          take,
          select: { id: true },
        }),
      async (ids) => {
        const result = await prisma.auditLog.deleteMany({ where: { id: { in: ids } } });
        return result.count;
      },
    ),
  ]);

  return {
    notificationsDeleted: byAgeNotifications + capNotifications,
    auditDeleted: byAgeAudit + capAudit,
  };
}

/**
 * Deletes old notifications/audit rows. Throttled so list/write paths stay cheap.
 */
export async function pruneDataRetention(options: {
  notificationDays: number;
  auditDays: number;
  force?: boolean;
}): Promise<DataRetentionResult> {
  const now = Date.now();
  if (!options.force && now - lastPruneAt < PRUNE_COOLDOWN_MS) {
    return { notificationsDeleted: 0, auditDeleted: 0 };
  }
  if (pruneInflight) return pruneInflight;

  pruneInflight = pruneNow(options.notificationDays, options.auditDays)
    .then((result) => {
      lastPruneAt = Date.now();
      return result;
    })
    .finally(() => {
      pruneInflight = null;
    });

  return pruneInflight;
}

/** Test helper – not used in production. */
export function resetRetentionThrottleForTests(): void {
  lastPruneAt = 0;
  pruneInflight = null;
}
