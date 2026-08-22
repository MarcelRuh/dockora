/**
 * Parse Docker "port already allocated" errors and resolve which container holds the host port.
 */

const PORT_PATTERNS = [
  // Host may be 0.0.0.0 or [::] – take digits after the last colon before "failed"
  /Bind for .*:(\d+) failed:\s*port is already allocated/i,
  /bind(?:ing)? for .*:(\d+) failed/i,
  /port is already allocated[^\d]*(\d{2,5})/i,
  /address already in use[^\d]*:?(\d{2,5})/i,
];

export function isPortConflictMessage(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes('port is already allocated') ||
    lower.includes('address already in use') ||
    /bind for .+:\d+ failed/i.test(message)
  );
}

/** Extract host port from a Docker/daemon port-conflict message. */
export function parseAllocatedHostPort(message: string): string | null {
  for (const pattern of PORT_PATTERNS) {
    const match = message.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
}

/**
 * Match host port in Dockora port strings, e.g. `3000->80/tcp` or `127.0.0.1:3000->80/tcp`.
 */
export function portBindingUsesHostPort(portBinding: string, hostPort: string): boolean {
  const m = portBinding.match(/(?:^|:)(\d+)->/);
  return m?.[1] === hostPort;
}

export function findContainerHoldingHostPort(
  containers: Array<{ name: string; ports: string[] }>,
  hostPort: string,
): string | null {
  for (const c of containers) {
    if (c.ports.some((p) => portBindingUsesHostPort(p, hostPort))) {
      return c.name;
    }
  }
  return null;
}

/** Append holder hint when we can resolve the conflicting container. */
export function enrichPortConflictMessage(
  message: string,
  containers: Array<{ name: string; ports: string[] }>,
): string {
  if (!isPortConflictMessage(message)) return message;
  const hostPort = parseAllocatedHostPort(message);
  if (!hostPort) return message;
  const holder = findContainerHoldingHostPort(containers, hostPort);
  if (!holder) {
    return `${message} (host port ${hostPort} is already in use)`;
  }
  return `${message} – host port ${hostPort} is used by container "${holder}" (change the mapping or stop that container)`;
}
