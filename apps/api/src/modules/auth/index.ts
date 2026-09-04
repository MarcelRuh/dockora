import bcrypt from 'bcryptjs';
import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import fjwt from '@fastify/jwt';
import {
  API_PREFIX,
  MIN_PASSWORD_LENGTH,
  type AuthLoginResponse,
  type AuthTotpConfirmResponse,
  type AuthTotpSetupResponse,
  type AuthUser,
  type UserRole,
} from '@dockora/shared';
import { prisma } from '../../infrastructure/db/prisma.js';
import { invalidateAuthEnabledCache, isAuthEnabled, isPublicAuthRoute, liftBearerToken, csrfMismatch } from './auth-gate.js';
import { clearSessionCookies, isSecureCookieRequest, jwtExpiresToSeconds, setSessionCookies } from './session-cookies.js';
import { ensureAuthEnabledStored } from '../settings/settings.service.js';
import {
  assertLoginAllowed,
  clearLoginFailures,
  loginLockKey,
  recordLoginFailure,
} from './login-lockout.js';
import { isWeakBootstrapPassword } from '../../config/env.js';
import { actorIdFromRequest, auditService } from '../audit/audit.service.js';
import {
  buildTotp,
  consumeBackupCode,
  decryptTotpSecret,
  encryptTotpSecret,
  generateBackupCodes,
  generateTotpSecret,
  hashBackupCodes,
  totpQrDataUrl,
  verifyTotpCode,
} from './totp.js';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string; role: UserRole; email: string; purpose?: 'totp' };
    user: { sub: string; role: UserRole; email: string; purpose?: 'totp' };
  }
}

const authPlugin: FastifyPluginAsync = async (app: FastifyInstance) => {
  await app.register(fjwt, {
    secret: app.config.jwtSecret,
    sign: { expiresIn: app.config.jwtExpiresIn },
  });

  app.decorate('authenticate', async (request: FastifyRequest) => {
    await request.jwtVerify();
    if (request.user.purpose === 'totp') {
      throw app.httpErrors.unauthorized('Complete two-factor authentication first');
    }
  });

  app.decorate('requireRole', (...roles: UserRole[]) => {
    return async (request: FastifyRequest) => {
      if (!(await isAuthEnabled())) return;
      await request.jwtVerify();
      if (request.user.purpose === 'totp') {
        throw app.httpErrors.unauthorized('Complete two-factor authentication first');
      }
      if (!roles.includes(request.user.role)) {
        throw app.httpErrors.forbidden('Insufficient role');
      }
    };
  });

  app.addHook('onRequest', async (request) => {
    liftBearerToken(request);
    if (isPublicAuthRoute(request.method, request.url)) return;
    if (csrfMismatch(request)) {
      throw app.httpErrors.forbidden('CSRF token mismatch');
    }
    if (!(await isAuthEnabled())) return;
    try {
      await request.jwtVerify();
      if (request.user.purpose === 'totp') {
        throw app.httpErrors.unauthorized('Complete two-factor authentication first');
      }
    } catch (error) {
      if (error && typeof error === 'object' && 'statusCode' in error) throw error;
      throw app.httpErrors.unauthorized('Authentication required');
    }
  });

  await ensureBootstrapAdmin(app);
  await ensureAuthEnabledStored();
  invalidateAuthEnabledCache();

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

      if (user.totpEnabled && user.totpSecretEnc) {
        const tempToken = await reply.jwtSign(
          {
            sub: user.id,
            role: user.role as UserRole,
            email: user.email,
            purpose: 'totp',
          },
          { expiresIn: '5m' },
        );
        const body: AuthLoginResponse = {
          requiresTotp: true,
          tempToken,
        };
        return body;
      }

      const token = await reply.jwtSign({
        sub: user.id,
        role: user.role as UserRole,
        email: user.email,
      });
      attachSession(request, reply, token);

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

  app.post<{
    Body: { tempToken: string; code: string };
  }>(
    `${API_PREFIX}/auth/login/totp`,
    {
      config: {
        rateLimit: {
          max: 30,
          timeWindow: '1 minute',
        },
      },
    },
    async (request, reply) => {
      const { tempToken, code } = request.body ?? {};
      if (!tempToken || !code) {
        throw app.httpErrors.badRequest('tempToken and code required');
      }

      let payload: { sub: string; role: UserRole; email: string; purpose?: string };
      try {
        payload = await app.jwt.verify(tempToken);
      } catch {
        throw app.httpErrors.unauthorized('TOTP session expired – login again');
      }
      if (payload.purpose !== 'totp') {
        throw app.httpErrors.unauthorized('Invalid TOTP session');
      }

      const lockKey = loginLockKey(request.ip || 'unknown', payload.email);
      try {
        assertLoginAllowed(lockKey);
      } catch (error) {
        throw app.httpErrors.tooManyRequests(
          error instanceof Error ? error.message : 'Too many failed logins',
        );
      }

      const user = await prisma.user.findUnique({ where: { id: payload.sub } });
      if (!user?.totpEnabled || !user.totpSecretEnc) {
        throw app.httpErrors.unauthorized('Two-factor authentication is not enabled');
      }

      let ok = false;
      let nextBackupHashes: string | null | undefined;

      try {
        const secret = decryptTotpSecret(user.totpSecretEnc, app.config.jwtSecret);
        ok = verifyTotpCode(secret, user.email, code);
      } catch {
        ok = false;
      }

      if (!ok) {
        nextBackupHashes = await consumeBackupCode(user.totpBackupHashes, code);
        ok = nextBackupHashes !== null;
      }

      if (!ok) {
        recordLoginFailure(lockKey);
        throw app.httpErrors.unauthorized('Invalid authentication code');
      }

      clearLoginFailures(lockKey);

      if (nextBackupHashes != null) {
        await prisma.user.update({
          where: { id: user.id },
          data: { totpBackupHashes: nextBackupHashes },
        });
      }

      const token = await reply.jwtSign({
        sub: user.id,
        role: user.role as UserRole,
        email: user.email,
      });
      attachSession(request, reply, token);

      void auditService.record({
        action: 'auth.login',
        actorId: user.id,
        resource: 'user',
        resourceId: user.id,
        metadata: { email: user.email, totp: true, backupCode: nextBackupHashes != null },
      });

      const body: AuthLoginResponse = {
        token,
        user: toAuthUser(user),
      };
      return body;
    },
  );

  app.post(`${API_PREFIX}/auth/logout`, async (_request, reply) => {
    clearSessionCookies(reply);
    return { ok: true as const };
  });

  app.get(`${API_PREFIX}/auth/me`, { preHandler: [app.authenticate] }, async (request) => {
    const user = await prisma.user.findUnique({ where: { id: request.user.sub } });
    if (!user) throw app.httpErrors.unauthorized('User not found');
    return toAuthUser(user);
  });

  app.post(`${API_PREFIX}/auth/totp/setup`, { preHandler: [app.authenticate] }, async (request) => {
    const user = await prisma.user.findUnique({ where: { id: request.user.sub } });
    if (!user) throw app.httpErrors.unauthorized('User not found');
    if (user.totpEnabled) {
      throw app.httpErrors.badRequest('Two-factor authentication is already enabled');
    }

    const secret = generateTotpSecret();
    const totp = buildTotp(secret, user.email);
    const otpauthUrl = totp.toString();
    const qrDataUrl = await totpQrDataUrl(otpauthUrl);

    await prisma.user.update({
      where: { id: user.id },
      data: {
        totpSecretEnc: encryptTotpSecret(secret, app.config.jwtSecret),
        totpEnabled: false,
        totpBackupHashes: null,
      },
    });

    const body: AuthTotpSetupResponse = { secret, otpauthUrl, qrDataUrl };
    return body;
  });

  app.post<{ Body: { code: string } }>(
    `${API_PREFIX}/auth/totp/confirm`,
    { preHandler: [app.authenticate] },
    async (request) => {
      const { code } = request.body ?? {};
      if (!code) throw app.httpErrors.badRequest('code required');

      const user = await prisma.user.findUnique({ where: { id: request.user.sub } });
      if (!user?.totpSecretEnc) {
        throw app.httpErrors.badRequest('Start TOTP setup first');
      }
      if (user.totpEnabled) {
        throw app.httpErrors.badRequest('Two-factor authentication is already enabled');
      }

      let secret: string;
      try {
        secret = decryptTotpSecret(user.totpSecretEnc, app.config.jwtSecret);
      } catch {
        throw app.httpErrors.badRequest('Invalid pending TOTP secret – run setup again');
      }

      if (!verifyTotpCode(secret, user.email, code)) {
        throw app.httpErrors.badRequest('Invalid authentication code');
      }

      const backupCodes = generateBackupCodes(8);
      const totpBackupHashes = await hashBackupCodes(backupCodes);
      const updated = await prisma.user.update({
        where: { id: user.id },
        data: { totpEnabled: true, totpBackupHashes },
      });

      void auditService.record({
        action: 'auth.totp.enable',
        actorId: user.id,
        resource: 'user',
        resourceId: user.id,
      });

      const body: AuthTotpConfirmResponse = {
        backupCodes,
        user: toAuthUser(updated),
      };
      return body;
    },
  );

  app.post<{ Body: { password: string; code?: string } }>(
    `${API_PREFIX}/auth/totp/disable`,
    { preHandler: [app.authenticate] },
    async (request) => {
      const { password, code } = request.body ?? {};
      if (!password) throw app.httpErrors.badRequest('password required');

      const user = await prisma.user.findUnique({ where: { id: request.user.sub } });
      if (!user) throw app.httpErrors.unauthorized('User not found');
      if (!(await bcrypt.compare(password, user.passwordHash))) {
        throw app.httpErrors.unauthorized('Invalid password');
      }

      if (user.totpEnabled && user.totpSecretEnc) {
        if (!code) throw app.httpErrors.badRequest('Authentication code required');
        let ok = false;
        try {
          const secret = decryptTotpSecret(user.totpSecretEnc, app.config.jwtSecret);
          ok = verifyTotpCode(secret, user.email, code);
        } catch {
          ok = false;
        }
        if (!ok) {
          const next = await consumeBackupCode(user.totpBackupHashes, code);
          ok = next !== null;
        }
        if (!ok) throw app.httpErrors.unauthorized('Invalid authentication code');
      }

      const updated = await prisma.user.update({
        where: { id: user.id },
        data: {
          totpEnabled: false,
          totpSecretEnc: null,
          totpBackupHashes: null,
        },
      });

      void auditService.record({
        action: 'auth.totp.disable',
        actorId: user.id,
        resource: 'user',
        resourceId: user.id,
      });

      return toAuthUser(updated);
    },
  );

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
    if (!email || !password || password.length < MIN_PASSWORD_LENGTH) {
      throw app.httpErrors.badRequest(
        `Valid email and password (min ${MIN_PASSWORD_LENGTH}) required`,
      );
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
      if (password != null && password.length < MIN_PASSWORD_LENGTH) {
        throw app.httpErrors.badRequest(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
      }

      const existing = await prisma.user.findUnique({ where: { id: request.params.id } });
      if (!existing) throw app.httpErrors.notFound('User not found');

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

function attachSession(request: FastifyRequest, reply: FastifyReply, token: string): void {
  setSessionCookies(reply, token, {
    secure: isSecureCookieRequest({
      protocol: request.protocol,
      forwardedProto: request.headers['x-forwarded-proto'],
    }),
    maxAge: jwtExpiresToSeconds(request.server.config.jwtExpiresIn),
  });
}

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
  totpEnabled?: boolean;
}): AuthUser {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role as UserRole,
    totpEnabled: Boolean(user.totpEnabled),
  };
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest) => Promise<void>;
    requireRole: (...roles: UserRole[]) => (request: FastifyRequest) => Promise<void>;
  }
}

export const authModule = fp(authPlugin, {
  name: 'dockora-auth',
  dependencies: [],
});
