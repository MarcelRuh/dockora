import type Docker from 'dockerode';

const IDLE_TIMEOUT_MS = 15 * 60 * 1000;
const MAX_MESSAGES_PER_WINDOW = 120;
const RATE_WINDOW_MS = 1_000;

export const ALLOWED_SHELLS = new Map<string, string>([
  ['/bin/sh', '/bin/sh'],
  ['sh', '/bin/sh'],
  ['/bin/bash', '/bin/bash'],
  ['/usr/bin/bash', '/usr/bin/bash'],
  ['bash', '/bin/bash'],
  ['/bin/ash', '/bin/ash'],
  ['ash', '/bin/ash'],
  ['/bin/zsh', '/bin/zsh'],
  ['/usr/bin/zsh', '/usr/bin/zsh'],
  ['zsh', '/bin/zsh'],
]);

export function resolveShell(input: string): string | null {
  return ALLOWED_SHELLS.get(input.trim()) ?? null;
}

/**
 * Prefer bash/zsh (readline + Tab completion). Fallback is interactive sh.
 * TERM is set here so we do not replace the container env via Docker Exec Env.
 */
export const INTERACTIVE_SHELL_BOOTSTRAP = [
  '/bin/sh',
  '-c',
  'TERM=${TERM:-xterm-256color}; export TERM; ' +
    'if command -v bash >/dev/null 2>&1; then exec bash -i; ' +
    'elif command -v zsh >/dev/null 2>&1; then exec zsh -i; ' +
    'else exec /bin/sh -i; fi',
] as const;

/** Docker exec argv: explicit allowlisted shell, or auto-detect. */
export function interactiveShellCommand(requested?: string): string[] | null {
  if (requested == null || requested.trim() === '') {
    return [...INTERACTIVE_SHELL_BOOTSTRAP];
  }
  const shell = resolveShell(requested);
  if (!shell) return null;
  return [shell, '-i'];
}

export type TerminalSocket = {
  readonly OPEN: number;
  readyState: number;
  send: (data: string) => void;
  close: (code?: number, reason?: string) => void;
  on: (event: 'message' | 'close', listener: (...args: never[]) => void) => void;
};

/**
 * Bidirektionale TTY-Brücke: Docker Exec-Stream ↔ WebSocket.
 */
export async function attachDockerExecSession(opts: {
  docker: Docker;
  containerIdOrName: string;
  cmd: string[];
  cols: number;
  rows: number;
  socket: TerminalSocket;
  onError?: (error: unknown) => void;
}): Promise<void> {
  const { docker, containerIdOrName, cmd, cols, rows, socket, onError } = opts;

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
    const container = docker.getContainer(containerIdOrName);
    const exec = await container.exec({
      Cmd: cmd,
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

    socket.on('message', ((message: Buffer | string) => {
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
    }) as (...args: never[]) => void);

    socket.on('close', (() => {
      if (idleTimer) clearTimeout(idleTimer);
      stream.destroy();
    }) as (...args: never[]) => void);
  } catch (error) {
    if (idleTimer) clearTimeout(idleTimer);
    onError?.(error);
    throw error;
  }
}
