import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import websocket from '@fastify/websocket';
import { API_PREFIX } from '@dockora/shared';
import type Docker from 'dockerode';
import { actorIdFromRequest, auditService } from '../audit/audit.service.js';
import { attachDockerExecSession, resolveShell } from './attach-exec.js';

/**
 * Web-Terminal via Docker Exec + WebSocket.
 *
 * Container: ws://host/api/v1/containers/:id/terminal?cols=&rows=&shell=
 *   Rollen: admin|operator
 *
 * Host (via host-agent + nsenter): ws://host/api/v1/system/host-terminal?cols=&rows=&shell=
 *   Rollen: admin only
 *
 * Auth: Sec-WebSocket-Protocol `dockora.jwt.<token>` (preferred) or `?token=` (legacy).
 */
export const terminalModule: FastifyPluginAsync = async (app: FastifyInstance) => {
  await app.register(websocket);

  const hostAgentName =
    process.env.DOCKORA_HOST_AGENT_CONTAINER?.trim() || 'dockora-host-agent';

  app.get(
    `${API_PREFIX}/containers/:id/terminal`,
    {
      websocket: true,
      preHandler: [app.requireRole('admin', 'operator')],
    },
    async (socket, request) => {
      const id = (request.params as { id: string }).id;
      const query = request.query as {
        cols?: string;
        rows?: string;
        shell?: string;
      };
      const cols = Number(query.cols ?? 80) || 80;
      const rows = Number(query.rows ?? 24) || 24;
      const shell = resolveShell(query.shell ?? '/bin/sh');
      if (!shell) {
        socket.send('\r\nShell not allowed\r\n');
        socket.close();
        return;
      }

      const docker = app.docker.getRaw() as Docker | null;
      if (!docker) {
        socket.send('\r\nDocker offline\r\n');
        socket.close();
        return;
      }

      try {
        await attachDockerExecSession({
          docker,
          containerIdOrName: id,
          cmd: [shell],
          cols,
          rows,
          socket: socket as never,
        });
      } catch (error) {
        request.log.error({ err: error }, 'Terminal exec failed');
        try {
          socket.send(
            `\r\nTerminal error: ${error instanceof Error ? error.message : 'unknown'}\r\n`,
          );
        } catch {
          // ignore
        }
        socket.close();
      }
    },
  );

  app.get(
    `${API_PREFIX}/system/host-terminal`,
    {
      websocket: true,
      preHandler: [app.requireRole('admin')],
    },
    async (socket, request) => {
      const query = request.query as {
        cols?: string;
        rows?: string;
        shell?: string;
      };
      const cols = Number(query.cols ?? 80) || 80;
      const rows = Number(query.rows ?? 24) || 24;
      // Host-Shell: /bin/sh ist nach nsenter -m das Host-/bin/sh
      const shell = resolveShell(query.shell ?? '/bin/sh');
      if (!shell) {
        socket.send('\r\nShell not allowed\r\n');
        socket.close();
        return;
      }

      const docker = app.docker.getRaw() as Docker | null;
      if (!docker) {
        socket.send('\r\nDocker offline\r\n');
        socket.close();
        return;
      }

      const agentReady = await isHostAgentRunning(docker, hostAgentName);
      if (!agentReady) {
        socket.send(
          `\r\nHost-Agent "${hostAgentName}" nicht erreichbar.\r\n` +
            'Starte den Service host-agent (pid: host) und versuche es erneut.\r\n',
        );
        socket.close();
        return;
      }

      void auditService.record({
        action: 'system.host_terminal',
        actorId: actorIdFromRequest(request),
        resource: 'host',
        resourceId: hostAgentName,
        metadata: { shell },
      });

      try {
        // nsenter in PID-1-Namespaces = LXC-/Host-Shell (nicht nur Container-FS)
        await attachDockerExecSession({
          docker,
          containerIdOrName: hostAgentName,
          cmd: ['nsenter', '-t', '1', '-m', '-u', '-i', '-n', '-p', '--', shell],
          cols,
          rows,
          socket: socket as never,
        });
      } catch (error) {
        request.log.error({ err: error }, 'Host terminal exec failed');
        try {
          socket.send(
            `\r\nHost terminal error: ${error instanceof Error ? error.message : 'unknown'}\r\n`,
          );
        } catch {
          // ignore
        }
        socket.close();
      }
    },
  );
};

async function isHostAgentRunning(docker: Docker, name: string): Promise<boolean> {
  try {
    const info = await docker.getContainer(name).inspect();
    return Boolean(info.State?.Running);
  } catch {
    return false;
  }
}
