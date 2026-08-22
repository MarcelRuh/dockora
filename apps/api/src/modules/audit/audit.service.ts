import { prisma } from '../../infrastructure/db/prisma.js';

export interface AuditEntry {
  action: string;
  actorId?: string | null;
  resource?: string | null;
  resourceId?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface AuditListItem {
  id: string;
  action: string;
  actorId: string | null;
  resource: string | null;
  resourceId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

/**
 * Persistente Audit-Logs. Schreibfehler dürfen Requests nicht abbrechen.
 */
export class AuditService {
  async record(entry: AuditEntry): Promise<void> {
    try {
      await prisma.auditLog.create({
        data: {
          action: entry.action,
          actorId: entry.actorId ?? null,
          resource: entry.resource ?? null,
          resourceId: entry.resourceId ?? null,
          metadata: entry.metadata ? JSON.stringify(entry.metadata) : null,
        },
      });
    } catch {
      // Audit darf die Hauptaktion nie blockieren
    }
  }

  async list(
    options: {
      limit?: number;
      action?: string;
      actorId?: string;
      resource?: string;
      since?: string;
      until?: string;
    } = {},
  ): Promise<AuditListItem[]> {
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
    const since = options.since ? new Date(options.since) : undefined;
    const until = options.until ? new Date(options.until) : undefined;

    const rows = await prisma.auditLog.findMany({
      where: {
        ...(options.action ? { action: { contains: options.action } } : {}),
        ...(options.actorId ? { actorId: options.actorId } : {}),
        ...(options.resource ? { resource: options.resource } : {}),
        ...(since || until
          ? {
              createdAt: {
                ...(since && !Number.isNaN(since.getTime()) ? { gte: since } : {}),
                ...(until && !Number.isNaN(until.getTime()) ? { lte: until } : {}),
              },
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return rows.map((row) => ({
      id: row.id,
      action: row.action,
      actorId: row.actorId,
      resource: row.resource,
      resourceId: row.resourceId,
      metadata: parseMetadata(row.metadata),
      createdAt: row.createdAt.toISOString(),
    }));
  }
}

function parseMetadata(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return { raw };
  }
}

export const auditService = new AuditService();

export function actorIdFromRequest(request: { user?: { sub?: string } }): string | null {
  return request.user?.sub ?? null;
}
