import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import websocket from '@fastify/websocket';
import { API_PREFIX } from '@dockora/shared';
import type Docker from 'dockerode';

const ALLOWED_SHELLS = new Map<string, string>([
  ['/bin/sh', '/bin/sh'],
  ['sh', '/bin/sh'],
  ['/bin/bash', '/bin/bash'],
  ['bash', '/bin/bash'],
  ['/bin/ash', '/bin/ash'],
  ['ash', '/bin/ash'],
  ['/bin/zsh', '/bin/zsh'],
  ['zsh', '/bin/zsh'],
]);

const IDLE_TIMEOUT_MS = 15 * 60 * 1000;
const MAX_MESSAGES_PER_WINDOW = 120;
const RATE_WINDOW_MS = 1_000;

/**
 * Web-Terminal via Docker Exec + WebSocket.
 * Client: ws://host/api/v1/containers/:id/terminal?cols=80&rows=24
 * Auth: Sec-WebSocket-Protocol `dockora.jwt.<token>` (preferred) or `?token=` (legacy).
 *
 * Bei aktivierter Auth: JWT erforderlich, Rollen admin|operator.
 * Idle-Timeout 15min, Message-Rate-Limit ~120/s.
 */
export const terminalModule: FastifyPluginAsync = async (app: FastifyInstance) => {
  await app.register(websocket);

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

      let idleTimer: NodeJS.Timeout | undefined;
      let msgCount = 0;
      let windowStart = Date.now();

      const bumpIdle = () => {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
          try {
            socket.send('\r\n[idle timeout]\r\n');
          } catch {
            // ignore
          }
          socket.close(1000, 'idle timeout');
        }, IDLE_TIMEOUT_MS);
      };

      const allowMessage = (): boolean => {
        const now = Date.now();
        if (now - windowStart >= RATE_WINDOW_MS) {
          windowStart = now;
          msgCount = 0;
        }
        msgCount += 1;
        return msgCount <= MAX_MESSAGES_PER_WINDOW;
      };

      bumpIdle();

      try {
        const container = docker.getContainer(id);
        const exec = await container.exec({
          Cmd: [shell],
          AttachStdin: true,
          AttachStdout: true,
          AttachStderr: true,
          Tty: true,
        });

        const stream = await exec.start({ hijack: true, stdin: true, Tty: true });
        await exec.resize({ h: rows, w: cols });

        stream.on('data', (chunk: Buffer) => {
          bumpIdle();
          if (socket.readyState === socket.OPEN) {
            socket.send(chunk.toString('utf8'));
          }
        });

        stream.on('end', () => socket.close());
        stream.on('error', () => socket.close());

        socket.on('message', (message: Buffer | string) => {
          bumpIdle();
          if (!allowMessage()) {
            try {
              socket.send('\r\n[rate limited]\r\n');
            } catch {
              // ignore
            }
            return;
          }
          const raw = typeof message === 'string' ? message : message.toString('utf8');
          try {
            const parsed = JSON.parse(raw) as { type?: string; cols?: number; rows?: number };
            if (parsed.type === 'resize' && parsed.cols && parsed.rows) {
              void exec.resize({ h: parsed.rows, w: parsed.cols });
              return;
            }
          } catch {
            // plain terminal input
          }
          stream.write(raw);
        });

        socket.on('close', () => {
          if (idleTimer) clearTimeout(idleTimer);
          stream.destroy();
        });
      } catch (error) {
        if (idleTimer) clearTimeout(idleTimer);
        request.log.error({ err: error }, 'Terminal exec failed');
        socket.send(
          `\r\nTerminal error: ${error instanceof Error ? error.message : 'unknown'}\r\n`,
        );
        socket.close();
      }
    },
  );
};

function resolveShell(input: string): string | null {
  return ALLOWED_SHELLS.get(input.trim()) ?? null;
}
