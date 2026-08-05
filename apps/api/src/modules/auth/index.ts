import bcrypt from 'bcryptjs';
import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import fjwt from '@fastify/jwt';
import { API_PREFIX, type AuthLoginResponse, type AuthUser, type UserRole } from '@dockora/shared';
import { prisma } from '../../infrastructure/db/prisma.js';
import { isAuthEnabled, isPublicAuthRoute, liftBearerToken } from './auth-gate.js';
import {
  assertLoginAllowed,
  clearLoginFailures,
  loginLockKey,
  recordLoginFailure,
} from './login-lockout.js';
import { isWeakBootstrapPassword } from '../../config/env.js';
import { actorIdFromRequest, auditService } from '../audit/audit.service.js';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string; role: UserRole; email: string };
    user: { sub: string; role: UserRole; email: string };
  }
}

const authPlugin: FastifyPluginAsync = async (app: FastifyInstance) => {
  await app.register(fjwt, {
    secret: app.config.jwtSecret,
    sign: { expiresIn: app.config.jwtExpiresIn },
  });

  app.decorate('authenticate', async (request: FastifyRequest) => {
    await request.jwtVerify();
  });

  app.decorate('requireRole', (...roles: UserRole[]) => {
    return async (request: FastifyRequest) => {
      // Ohne aktivierte Auth keine Rollenprüfung (Dev/offen)
      if (!(await isAuthEnabled())) return;
      await request.jwtVerify();
      if (!roles.includes(request.user.role)) {
        throw app.httpErrors.forbidden('Insufficient role');
      }
    };
  });

  /**
   * Globaler Gate: wenn authEnabled, brauchen alle Nicht-Public-Routen ein gültiges JWT.
   * fastify-plugin bricht Encapsulation, damit der Hook app-weit gilt.
   */
  app.addHook('onRequest', async (request) => {
    liftBearerToken(request);
    if (isPublicAuthRoute(request.method, request.url)) return;
    if (!(await isAuthEnabled())) return;
    try {
      await request.jwtVerify();
    } catch {
      throw app.httpErrors.unauthorized('Authentication required');
    }
  });

  await ensureBootstrapAdmin(app);

  app.get(`${API_PREFIX}/auth/status`, async () => {
    return { authEnabled: await isAuthEnabled() };
  });

  app.post<{
    Body: { email: string; password: string };
  }>(
    `${API_PREFIX}/auth/login`,
    {
      config: {
        rateLimit: {
          max: 20,
          timeWindow: '1 minute',
        },
      },
    },
    async (request, reply) => {
      const { email, password } = request.body ?? {};
      if (!email || !password) {
        throw app.httpErrors.badRequest('email and password required');
      }

      const lockKey = loginLockKey(request.ip || 'unknown', email);
      try {
        assertLoginAllowed(lockKey);
      } catch (error) {
        throw app.httpErrors.tooManyRequests(
          error instanceof Error ? error.message : 'Too many failed logins',
        );
      }

      const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
      if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
        recordLoginFailure(lockKey);
        throw app.httpErrors.unauthorized('Invalid credentials');
      }

      clearLoginFailures(lockKey);

      const token = await reply.jwtSign({
        sub: user.id,
        role: user.role as UserRole,
        email: user.email,
      });

      void auditService.record({
        action: 'auth.login',
        actorId: user.id,
        resource: 'user',
        resourceId: user.id,
        metadata: { email: user.email },
      });

      const body: AuthLoginResponse = {
        token,
        user: toAuthUser(user),
      };
      return body;
    },
  );

  app.get(`${API_PREFIX}/auth/me`, { preHandler: [app.authenticate] }, async (request) => {
    const user = await prisma.user.findUnique({ where: { id: request.user.sub } });
    if (!user) throw app.httpErrors.unauthorized('User not found');
    return toAuthUser(user);
  });

  app.get(
    `${API_PREFIX}/auth/users`,
    { preHandler: [app.requireRole('admin')] },
    async () => {
      const users = await prisma.user.findMany({ orderBy: { createdAt: 'asc' } });
      return users.map(toAuthUser);
    },
  );

  app.post<{
    Body: { email: string; password: string; displayName?: string; role?: UserRole };
  }>(`${API_PREFIX}/auth/users`, { preHandler: [app.requireRole('admin')] }, async (request) => {
    const { email, password, displayName, role } = request.body ?? {};
    if (!email || !password || password.length < 8) {
      throw app.httpErrors.badRequest('Valid email and password (min 8) required');
    }
    const passwordHash = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: {
        email: email.toLowerCase(),
        passwordHash,
        displayName: displayName ?? null,
        role: role ?? 'viewer',
      },
    });
    void auditService.record({
      action: 'auth.user.create',
      actorId: actorIdFromRequest(request),
      resource: 'user',
      resourceId: user.id,
      metadata: { email: user.email, role: user.role },
    });
    return toAuthUser(user);
  });

  app.patch<{
    Params: { id: string };
    Body: { role?: UserRole; displayName?: string | null; password?: string };
  }>(
    `${API_PREFIX}/auth/users/:id`,
    { preHandler: [app.requireRole('admin')] },
    async (request) => {
      const { role, displayName, password } = request.body ?? {};
      if (role == null && displayName === undefined && !password) {
        throw app.httpErrors.badRequest('Nothing to update');
      }
      if (role && !['admin', 'operator', 'viewer'].includes(role)) {
        throw app.httpErrors.badRequest('Invalid role');
      }
      if (password != null && password.length < 8) {
        throw app.httpErrors.badRequest('Password must be at least 8 characters');
      }

      const existing = await prisma.user.findUnique({ where: { id: request.params.id } });
      if (!existing) throw app.httpErrors.notFound('User not found');

      // Letzten Admin nicht degradieren
      if (existing.role === 'admin' && role && role !== 'admin') {
        const adminCount = await prisma.user.count({ where: { role: 'admin' } });
        if (adminCount <= 1) {
          throw app.httpErrors.badRequest('Cannot demote the last admin');
        }
      }

      const user = await prisma.user.update({
        where: { id: request.params.id },
        data: {
          ...(role ? { role } : {}),
          ...(displayName !== undefined ? { displayName } : {}),
          ...(password ? { passwordHash: await bcrypt.hash(password, 12) } : {}),
        },
      });

      void auditService.record({
        action: 'auth.user.update',
        actorId: actorIdFromRequest(request),
        resource: 'user',
        resourceId: user.id,
        metadata: {
          role: role ?? undefined,
          displayNameChanged: displayName !== undefined,
          passwordChanged: Boolean(password),
        },
      });
      return toAuthUser(user);
    },
  );

  app.delete<{ Params: { id: string } }>(
    `${API_PREFIX}/auth/users/:id`,
    { preHandler: [app.requireRole('admin')] },
    async (request, reply) => {
      const existing = await prisma.user.findUnique({ where: { id: request.params.id } });
      if (!existing) throw app.httpErrors.notFound('User not found');

      if (request.user.sub === existing.id) {
        throw app.httpErrors.badRequest('Cannot delete your own account');
      }

      if (existing.role === 'admin') {
        const adminCount = await prisma.user.count({ where: { role: 'admin' } });
        if (adminCount <= 1) {
          throw app.httpErrors.badRequest('Cannot delete the last admin');
        }
      }

      await prisma.user.delete({ where: { id: existing.id } });
      void auditService.record({
        action: 'auth.user.delete',
        actorId: actorIdFromRequest(request),
        resource: 'user',
        resourceId: existing.id,
        metadata: { email: existing.email },
      });
      return reply.status(204).send();
    },
  );
};

async function ensureBootstrapAdmin(app: FastifyInstance): Promise<void> {
  const count = await prisma.user.count();
  if (count > 0) return;

  const email = app.config.bootstrapAdminEmail;
  const password = app.config.bootstrapAdminPassword;

  if (app.config.nodeEnv === 'production') {
    if (!password || isWeakBootstrapPassword(password)) {
      throw new Error(
        'Cannot bootstrap admin in production without a strong BOOTSTRAP_ADMIN_PASSWORD',
      );
    }
  }

  const resolvedPassword = password ?? 'dockora-admin-change-me';
  if (app.config.nodeEnv !== 'production' && (!password || isWeakBootstrapPassword(resolvedPassword))) {
    app.log.warn(
      { email },
      'Bootstrap admin uses a weak/default password – set BOOTSTRAP_ADMIN_PASSWORD before production',
    );
  }

  const passwordHash = await bcrypt.hash(resolvedPassword, 12);
  await prisma.user.create({
    data: {
      email,
      passwordHash,
      displayName: 'Administrator',
      role: 'admin',
    },
  });
  app.log.warn({ email }, 'Bootstrap admin user created');
}

function toAuthUser(user: {
  id: string;
  email: string;
  displayName: string | null;
  role: string;
}): AuthUser {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role as UserRole,
  };
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest) => Promise<void>;
    requireRole: (...roles: UserRole[]) => (request: FastifyRequest) => Promise<void>;
  }
}

/** Breaks encapsulation so JWT + auth gate apply to all modules. */
export const authModule = fp(authPlugin, {
  name: 'dockora-auth',
  dependencies: [],
});
