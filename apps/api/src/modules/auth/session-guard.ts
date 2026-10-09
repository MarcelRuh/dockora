import type { UserRole } from '@dockora/shared';
import type { FastifyRequest } from 'fastify';
import { prisma } from '../../infrastructure/db/prisma.js';

const CACHE_TTL_MS = 2_000;
const cache = new Map<string, { at: number; role: UserRole; sessionVersion: number }>();

export function clearSessionGuardCache(userId?: string): void {
  if (userId) cache.delete(userId);
  else cache.clear();
}

/**
 * Reject JWTs after password/role changes and refresh role from the database.
 */
export async function assertFreshSession(request: FastifyRequest): Promise<void> {
  const userId = request.user?.sub;
  if (!userId) throw Object.assign(new Error('Authentication required'), { statusCode: 401 });

  const now = Date.now();
  let row = cache.get(userId);
  if (!row || now - row.at >= CACHE_TTL_MS) {
    const db = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, sessionVersion: true },
    });
    if (!db) {
      cache.delete(userId);
      throw Object.assign(new Error('Authentication required'), { statusCode: 401 });
    }
    row = {
      at: now,
      role: db.role as UserRole,
      sessionVersion: db.sessionVersion,
    };
    cache.set(userId, row);
  }

  const tokenSv = typeof request.user.sv === 'number' ? request.user.sv : 0;
  if (tokenSv !== row.sessionVersion) {
    cache.delete(userId);
    throw Object.assign(new Error('Session expired – sign in again'), { statusCode: 401 });
  }

  request.user.role = row.role;
}

export async function bumpSessionVersion(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { sessionVersion: { increment: 1 } },
  });
  clearSessionGuardCache(userId);
}
