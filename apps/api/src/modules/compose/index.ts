import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import {
  API_PREFIX,
  type ActionResult,
  type BackupInfo,
  type ComposeAction,
  type ComposeProjectDetails,
  type ComposeProjectSummary,
} from '@dockora/shared';
import {
  ComposeNotFoundError,
  ComposeService,
  ComposeValidationError,
} from './compose.service.js';
import { actorIdFromRequest, auditService } from '../audit/audit.service.js';

const COMPOSE_ACTIONS = new Set<ComposeAction>([
  'up',
  'down',
  'restart',
  'pull',
  'build',
  'recreate',
]);

const DESTRUCTIVE_ACTIONS = new Set<ComposeAction>(['down', 'recreate']);

const destructiveRateLimit = {
  config: {
    rateLimit: {
      max: 10,
      timeWindow: '1 minute',
    },
  },
} as const;

/**
 * Compose-Modul – Discovery, Lifecycle-Aktionen, YAML-Editor und Backups.
 */
export const composeModule: FastifyPluginAsync = async (app: FastifyInstance) => {
  const service = new ComposeService({
    docker: app.docker,
    searchPaths: app.config.composeSearchPaths,
    excludePaths: app.config.composeExcludePaths,
  });

  app.get(`${API_PREFIX}/compose`, async (): Promise<ComposeProjectSummary[]> => {
    try {
      return await service.list();
    } catch (error) {
      throwComposeError(app, error);
    }
  });

  app.get(`${API_PREFIX}/compose/bases`, async () => {
    return { bases: service.listBasePaths() };
  });

  app.post<{
    Body: {
      name: string;
      basePath: string;
      composeFileName?: string;
      yaml: string;
      envContent?: string;
      start?: boolean;
    };
  }>(`${API_PREFIX}/compose`, { ...destructiveRateLimit }, async (request): Promise<ComposeProjectDetails> => {
    const body = request.body ?? ({} as never);
    if (!body.name || !body.basePath || !body.yaml) {
      throw app.httpErrors.badRequest('name, basePath and yaml are required');
    }
    try {
      const created = await service.create({
        name: body.name,
        basePath: body.basePath,
        composeFileName: body.composeFileName,
        yaml: body.yaml,
        envContent: body.envContent,
        start: body.start === true,
      });
      void auditService.record({
        action: 'compose.create',
        actorId: actorIdFromRequest(request),
        resource: 'compose',
        resourceId: created.id,
        metadata: { name: created.name, path: created.path },
      });
      return created;
    } catch (error) {
      throwComposeError(app, error);
    }
  });

  app.get<{ Params: { id: string } }>(
    `${API_PREFIX}/compose/:id/logs`,
    async (request): Promise<string> => {
      try {
        return await service.logs(request.params.id);
      } catch (error) {
        throwComposeError(app, error);
      }
    },
  );

  app.get<{ Params: { id: string } }>(
    `${API_PREFIX}/compose/:id/config`,
    async (request): Promise<string> => {
      try {
        return await service.validateConfig(request.params.id);
      } catch (error) {
        throwComposeError(app, error);
      }
    },
  );

  app.put<{ Params: { id: string }; Body: { content: string } }>(
    `${API_PREFIX}/compose/:id/yaml`,
    async (request): Promise<ComposeProjectDetails> => {
      if (!request.body?.content || typeof request.body.content !== 'string') {
        throw app.httpErrors.badRequest('Request body must include content: string');
      }
      try {
        return await service.updateYaml(request.params.id, request.body.content);
      } catch (error) {
        throwComposeError(app, error);
      }
    },
  );

  app.get<{ Params: { id: string }; Querystring: { file?: string } }>(
    `${API_PREFIX}/compose/:id/env`,
    async (request) => {
      try {
        return await service.getEnvFile(request.params.id, request.query.file ?? '.env');
      } catch (error) {
        throwComposeError(app, error);
      }
    },
  );

  app.put<{
    Params: { id: string };
    Body: { content: string; fileName?: string };
  }>(`${API_PREFIX}/compose/:id/env`, async (request) => {
    if (typeof request.body?.content !== 'string') {
      throw app.httpErrors.badRequest('Request body must include content: string');
    }
    try {
      return await service.updateEnvFile(
        request.params.id,
        request.body.content,
        request.body.fileName ?? '.env',
      );
    } catch (error) {
      throwComposeError(app, error);
    }
  });

  app.post<{ Params: { id: string } }>(
    `${API_PREFIX}/compose/:id/backup`,
    async (request): Promise<BackupInfo> => {
      try {
        return await service.backup(request.params.id);
      } catch (error) {
        throwComposeError(app, error);
      }
    },
  );

  app.delete<{
    Params: { id: string };
    Querystring: { removeFiles?: string; removeVolumes?: string };
  }>(
    `${API_PREFIX}/compose/:id`,
    {
      preHandler: [app.requireRole('admin')],
      ...destructiveRateLimit,
    },
    async (request): Promise<ActionResult> => {
      try {
        const result = await service.remove(request.params.id, {
          removeFiles: request.query.removeFiles !== 'false',
          removeVolumes: request.query.removeVolumes === 'true',
        });
        void auditService.record({
          action: 'compose.delete',
          actorId: actorIdFromRequest(request),
          resource: 'compose',
          resourceId: request.params.id,
          metadata: {
            removeFiles: request.query.removeFiles !== 'false',
            removeVolumes: request.query.removeVolumes === 'true',
          },
        });
        return result;
      } catch (error) {
        throwComposeError(app, error);
      }
    },
  );

  app.post<{ Params: { id: string; action: string } }>(
    `${API_PREFIX}/compose/:id/:action`,
    {
      ...destructiveRateLimit,
      preHandler: [
        async (request) => {
          const action = request.params.action as ComposeAction;
          if (action === 'down') {
            await app.requireRole('admin')(request);
          } else if (action === 'recreate') {
            await app.requireRole('admin', 'operator')(request);
          }
        },
      ],
    },
    async (request): Promise<ActionResult> => {
      const action = request.params.action as ComposeAction;
      if (!COMPOSE_ACTIONS.has(action)) {
        throw app.httpErrors.badRequest(`Unknown compose action: ${request.params.action}`);
      }
      try {
        const result = await service.runAction(request.params.id, action);
        if (DESTRUCTIVE_ACTIONS.has(action)) {
          void auditService.record({
            action: `compose.${action}`,
            actorId: actorIdFromRequest(request),
            resource: 'compose',
            resourceId: request.params.id,
          });
        }
        return result;
      } catch (error) {
        throwComposeError(app, error);
      }
    },
  );

  app.get<{ Params: { id: string } }>(
    `${API_PREFIX}/compose/:id`,
    async (request): Promise<ComposeProjectDetails> => {
      try {
        return await service.getDetails(request.params.id);
      } catch (error) {
        throwComposeError(app, error);
      }
    },
  );
};

function throwComposeError(app: FastifyInstance, error: unknown): never {
  if (error instanceof ComposeNotFoundError) {
    throw app.httpErrors.notFound(error.message);
  }
  if (error instanceof ComposeValidationError) {
    throw app.httpErrors.badRequest(error.message);
  }

  const err = error as { code?: number; killed?: boolean; message?: string; stderr?: string };
  const message = err.stderr?.trim() || err.message || 'Compose operation failed';

  if (message.toLowerCase().includes('no such file')) {
    throw app.httpErrors.notFound(message);
  }
  if (err.code === 127 || message.includes('ENOENT')) {
    throw app.httpErrors.internalServerError('docker compose CLI not available');
  }
  throw app.httpErrors.internalServerError(message);
}
