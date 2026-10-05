import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { API_PREFIX, APP_NAME, APP_VERSION } from '@dockora/shared';
import { isViewer } from '../auth/auth-gate.js';
import { actorIdFromRequest, auditService } from '../audit/audit.service.js';
import { destructiveRateLimit } from '../../presentation/http/destructive-rate-limit.js';
import { DockerHostUpdateService, type DockerHostComponent } from './docker-host-update.service.js';
import { SelfUpdateService } from './self-update.service.js';

/**
 * System-Meta – App-Info und Self-Update.
 */
export const systemModule: FastifyPluginAsync = async (app: FastifyInstance) => {
  const dockerHostUpdates = new DockerHostUpdateService();
  const selfUpdate = new SelfUpdateService(app.docker, {
    installDirHost: app.config.installDirHost,
    installDirMount: app.config.installDirMount,
    repo: app.config.repo,
    branch: app.config.updateBranch,
    gitSha: app.config.gitSha,
    selfImage: app.config.selfImage,
  });

  app.get(`${API_PREFIX}/system/info`, async (request) => {
    const viewer = await isViewer(request);
    return {
      name: APP_NAME,
      version: APP_VERSION,
      nodeEnv: app.config.nodeEnv,
      composeSearchPaths: viewer ? [] : app.config.composeSearchPaths,
      composeExcludePaths: viewer ? [] : app.config.composeExcludePaths,
      autoUpdateEnabled: app.config.autoUpdateEnabled,
      selfImage: viewer ? '' : app.config.selfImage,
      installDir: viewer ? null : app.config.installDirHost,
      repo: app.config.repo,
      updateBranch: app.config.updateBranch,
      pluginDir: viewer ? '' : app.config.pluginDir,
    };
  });

  app.get(`${API_PREFIX}/system/self-update`, async (request) => {
    const status = await selfUpdate.status();
    if (!(await isViewer(request))) return status;
    return {
      ...status,
      installDir: null,
      message: status.message.replace(/\s*\([^)]*[/\\][^)]*\)/g, '').trim(),
    };
  });

  app.post(
    `${API_PREFIX}/system/self-update`,
    { preHandler: [app.requireRole('admin')] },
    async (request) => {
      const result = await selfUpdate.apply();
      void auditService.record({
        action: 'system.self-update',
        actorId: actorIdFromRequest(request),
        resource: 'system',
        metadata: {
          ok: result.ok,
          mode: result.mode,
          image: app.config.selfImage,
          installDir: app.config.installDirHost,
        },
      });
      if (!result.ok) {
        throw app.httpErrors.badRequest(result.message);
      }
      return result;
    },
  );

  app.get(`${API_PREFIX}/system/docker-update`, async () => {
    return dockerHostUpdates.status();
  });

  app.post<{ Body: { target?: string } }>(
    `${API_PREFIX}/system/docker-update`,
    { ...destructiveRateLimit, preHandler: [app.requireRole('admin')] },
    async (request) => {
      const target = request.body?.target;
      if (target !== 'engine' && target !== 'compose') {
        throw app.httpErrors.badRequest('target must be engine or compose');
      }
      const component = target as DockerHostComponent;
      request.raw.setTimeout(11 * 60 * 1000);
      request.raw.socket.setTimeout(11 * 60 * 1000);
      const result = await dockerHostUpdates.apply(component);
      void auditService.record({
        action: 'system.docker-update',
        actorId: actorIdFromRequest(request),
        resource: 'system',
        metadata: { ok: result.ok, target: component },
      });
      if (!result.ok) {
        throw app.httpErrors.badRequest(result.message);
      }
      return result;
    },
  );
};
