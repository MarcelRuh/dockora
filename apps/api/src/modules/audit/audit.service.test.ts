import { beforeEach, describe, expect, it, vi } from 'vitest';

const create = vi.fn();
const findMany = vi.fn();

vi.mock('../../infrastructure/db/prisma.js', () => ({
  prisma: {
    auditLog: {
      create: (...args: unknown[]) => create(...args),
      findMany: (...args: unknown[]) => findMany(...args),
    },
  },
}));

describe('AuditService', () => {
  beforeEach(() => {
    create.mockReset();
    findMany.mockReset();
  });

  it('records entries with JSON metadata', async () => {
    const { AuditService } = await import('./audit.service.js');
    const service = new AuditService();
    create.mockResolvedValue({});

    await service.record({
      action: 'auth.login',
      actorId: 'u1',
      resource: 'user',
      resourceId: 'u1',
      metadata: { email: 'a@b.c' },
    });

    expect(create).toHaveBeenCalledWith({
      data: {
        action: 'auth.login',
        actorId: 'u1',
        resource: 'user',
        resourceId: 'u1',
        metadata: JSON.stringify({ email: 'a@b.c' }),
      },
    });
  });

  it('swallows write errors', async () => {
    const { AuditService } = await import('./audit.service.js');
    const service = new AuditService();
    create.mockRejectedValue(new Error('db down'));

    await expect(service.record({ action: 'x' })).resolves.toBeUndefined();
  });

  it('lists and parses metadata', async () => {
    const { AuditService } = await import('./audit.service.js');
    const service = new AuditService();
    findMany.mockResolvedValue([
      {
        id: '1',
        action: 'settings.update',
        actorId: 'u1',
        resource: 'settings',
        resourceId: null,
        metadata: '{"keys":["locale"]}',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ]);

    const rows = await service.list({ limit: 10 });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.metadata).toEqual({ keys: ['locale'] });
  });
});
