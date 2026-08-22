import type { ContainerStatus } from '@dockora/shared';

const KNOWN: ReadonlySet<string> = new Set([
  'created',
  'running',
  'paused',
  'restarting',
  'removing',
  'exited',
  'dead',
]);

export function mapContainerStatus(state: string | undefined): ContainerStatus {
  const normalized = (state ?? '').toLowerCase();
  if (KNOWN.has(normalized)) {
    return normalized as ContainerStatus;
  }
  return 'unknown';
}

export function formatPorts(
  ports: Array<{
    IP?: string;
    PrivatePort?: number;
    PublicPort?: number;
    Type?: string;
  }> = [],
): string[] {
  return ports.map((p) => {
    const proto = p.Type ?? 'tcp';
    if (p.PublicPort) {
      const ip = p.IP && p.IP !== '0.0.0.0' ? `${p.IP}:` : '';
      return `${ip}${p.PublicPort}->${p.PrivatePort ?? '?'}/${proto}`;
    }
    return `${p.PrivatePort ?? '?'}/${proto}`;
  });
}

export function isUnhealthyContainer(input: {
  status: ContainerStatus;
  health?: 'healthy' | 'unhealthy' | 'starting' | 'none';
  exitCode?: number;
}): boolean {
  if (input.health === 'unhealthy') return true;
  if (input.status === 'dead') return true;
  if (input.status === 'exited' && typeof input.exitCode === 'number' && input.exitCode !== 0) {
    return true;
  }
  return false;
}

export function summarizeContainers(
  containers: Array<{
    status: ContainerStatus;
    health?: 'healthy' | 'unhealthy' | 'starting' | 'none';
    exitCode?: number;
  }>,
): { total: number; running: number; stopped: number; unhealthy: number } {
  let running = 0;
  let stopped = 0;
  let unhealthy = 0;

  for (const c of containers) {
    if (c.status === 'running' || c.status === 'paused' || c.status === 'restarting') {
      running += 1;
    } else {
      stopped += 1;
    }
    if (isUnhealthyContainer(c)) {
      unhealthy += 1;
    }
  }

  return {
    total: containers.length,
    running,
    stopped,
    unhealthy,
  };
}
