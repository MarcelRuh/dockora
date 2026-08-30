import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import {
  API_PREFIX,
  type ActionResult,
  type BackupInfo,
  type ComposeAction,
  type ComposeProjectDetails,
  type ComposeProjectSummary,
} from '@dockora/shared';
import { actorIdFromRequest, auditService } from '../audit/audit.service.js';
import {
  ComposeNotFoundError,
  ComposeService,
  ComposeValidationError,
} from './compose.service.js';
import { UnsafeProjectPathError } from './safe-project-dir.js';
import { invalidateComposeDiscoveryCache } from './compose-discovery.js';
import { destructiveRateLimit } from '../../presentation/http/destructive-rate-limit.js';
import {
  enrichPortConflictMessage,
  isPortConflictMessage,
} from '../../domain/port-conflict.js';

const COMPOSE_ACTIONS = new Set<ComposeAction>([
  'up',
  'down',
  'restart',
  'pull',
  'build',
  'recreate',
]);

const DESTRUCTIVE_ACTIONS = new Set<ComposeAction>(['down', 'recreate']);


/**
 * Compose-Modul – Discovery, Lifecycle-Aktionen, YAML-Editor und Backups.
 */
export const composeModule: FastifyPluginAsync = async (app: FastifyInstance) => {
  const service = new ComposeService({
    docker: app.docker,
    searchPaths: app.config.composeSearchPaths,
    excludePaths: app.config.composeExcludePaths,
  });

  await service.ensureSearchRoots();

  app.docker.subscribeResourceChanges((event) => {
    if (event.type === 'container') invalidateComposeDiscoveryCache();
  });

  app.get(`${API_PREFIX}/compose`, async (): Promise<ComposeProjectSummary[]> => {
    try {
      return await service.list();
    } catch (error) {
      return await throwComposeError(app, error);
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
      return await throwComposeError(app, error);
    }
  });

  app.get<{ Params: { id: string }; Querystring: { service?: string } }>(
    `${API_PREFIX}/compose/:id/logs`,
    async (request): Promise<{ logs: string }> => {
      try {
        // Wrap as JSON — bare strings are sent as text by Fastify and break the web client JSON.parse
        return { logs: await service.logs(request.params.id, request.query.service) };
      } catch (error) {
        return await throwComposeError(app, error);
      }
    },
  );

  app.get<{ Params: { id: string } }>(
    `${API_PREFIX}/compose/:id/config`,
    async (request): Promise<{ config: string }> => {
      try {
        // `docker compose config` returns YAML; wrap so the response is valid JSON
        return { config: await service.validateConfig(request.params.id) };
      } catch (error) {
        return await throwComposeError(app, error);
      }
    },
  );

  app.get<{ Params: { id: string } }>(
    `${API_PREFIX}/compose/:id/preview`,
    async (request) => {
      try {
        return await service.previewChanges(request.params.id);
      } catch (error) {
        return await throwComposeError(app, error);
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
        return await throwComposeError(app, error);
      }
    },
  );

  app.get<{ Params: { id: string }; Querystring: { file?: string } }>(
    `${API_PREFIX}/compose/:id/env`,
    async (request) => {
      try {
        return await service.getEnvFile(request.params.id, request.query.file ?? '.env');
      } catch (error) {
        return await throwComposeError(app, error);
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
      return await throwComposeError(app, error);
    }
  });

  app.post<{ Params: { id: string } }>(
    `${API_PREFIX}/compose/:id/backup`,
    async (request): Promise<BackupInfo> => {
      try {
        return await service.backup(request.params.id);
      } catch (error) {
        return await throwComposeError(app, error);
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
        return await throwComposeError(app, error);
      }
    },
  );

  app.post<{ Params: { id: string; action: string }; Querystring: { service?: string } }>(
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
        const result = await service.runAction(
          request.params.id,
          action,
          request.query.service,
        );
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
        return await throwComposeError(app, error);
      }
    },
  );

  app.get<{ Params: { id: string } }>(
    `${API_PREFIX}/compose/:id`,
    async (request): Promise<ComposeProjectDetails> => {
      try {
        return await service.getDetails(request.params.id);
      } catch (error) {
        return await throwComposeError(app, error);
      }
    },
  );
};

async function enrichIfPortConflict(
  app: FastifyInstance,
  message: string,
): Promise<string> {
  if (!isPortConflictMessage(message) || !app.docker) return message;
  try {
    const containers = await app.docker.listContainers(true);
    return enrichPortConflictMessage(message, containers);
  } catch {
    return message;
  }
}

async function throwComposeError(app: FastifyInstance, error: unknown): Promise<never> {
  if (error instanceof ComposeNotFoundError) {
    throw app.httpErrors.notFound(error.message);
  }
  if (error instanceof ComposeValidationError || error instanceof UnsafeProjectPathError) {
    throw app.httpErrors.badRequest(await enrichIfPortConflict(app, error.message));
  }

  const err = error as { code?: number; killed?: boolean; message?: string; stderr?: string };
  const raw = err.stderr?.trim() || err.message || 'Compose operation failed';
  let message = summarizeComposeCliError(raw);

  if (message.toLowerCase().includes('no such file')) {
    throw app.httpErrors.notFound(message);
  }
  if (err.code === 127 || message.includes('ENOENT')) {
    throw app.httpErrors.internalServerError('docker compose CLI not available');
  }

  message = await enrichIfPortConflict(app, message);

  // Port conflicts / start failures are user-fixable, not opaque 500s
  const lower = message.toLowerCase();
  if (
    lower.includes('port is already allocated') ||
    lower.includes('bind for') ||
    lower.includes('address already in use') ||
    lower.includes('failed to set up container networking') ||
    lower.includes('conflict') ||
    lower.includes('permission denied') ||
    lower.includes('no such image') ||
    lower.includes('error response from daemon')
  ) {
    throw app.httpErrors.badRequest(message);
  }

  throw app.httpErrors.badRequest(message);
}

/** Prefer the last actionable Error/… line from verbose `docker compose` output. */
function summarizeComposeCliError(raw: string): string {
  const lines = raw
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const errorLine = [...lines].reverse().find((l) => /^error\b/i.test(l) || /failed/i.test(l));
  if (errorLine) return errorLine.length > 500 ? `${errorLine.slice(0, 500)}…` : errorLine;
  if (raw.length > 600) return `${raw.slice(-600)}`;
  return raw;
}
