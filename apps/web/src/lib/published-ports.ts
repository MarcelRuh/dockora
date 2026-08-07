/** Parse Docker port strings like `8080->80/tcp`, `0.0.0.0:5055->5055/tcp`, `:::6868->6868/tcp`. */
export function publishedPortHref(
  portMapping: string,
  pageHost: string,
): { label: string; href: string | null; hostPort: string | null } {
  const match = portMapping.match(/(?:^|:)(\d+)->(\d+)\/(\w+)$/);
  if (!match) {
    return { label: portMapping, href: null, hostPort: null };
  }

  const hostPort = match[1]!;
  const proto = match[3]!.toLowerCase();
  if (proto !== 'tcp') {
    return { label: portMapping, href: null, hostPort };
  }

  let host = pageHost;
  const bindMatch = portMapping.match(/^(\[[^\]]+\]|[^:[\]]+):\d+->/);
  if (bindMatch) {
    const bindIp = bindMatch[1]!;
    if (bindIp !== '0.0.0.0' && bindIp !== '::' && bindIp !== '[::]') {
      const normalized = bindIp.replace(/^\[|\]$/g, '');
      // Loopback binds: still link via the page host for LAN browsers.
      if (normalized !== '127.0.0.1' && normalized !== '::1') {
        host = normalized.includes(':') ? `[${normalized}]` : normalized;
      }
    }
  }

  return {
    label: hostPort,
    href: `http://${host}:${hostPort}`,
    hostPort,
  };
}

/** Prefer IPv4-style mappings; drop duplicate host ports (e.g. :::8080). */
export function uniquePublishedPorts(ports: string[]): string[] {
  const seen = new Set<string>();
  const preferred: string[] = [];
  const rest: string[] = [];

  for (const port of ports) {
    const hostPort = port.match(/(?:^|:)(\d+)->/)?.[1];
    if (!hostPort) {
      rest.push(port);
      continue;
    }
    if (seen.has(hostPort)) continue;
    seen.add(hostPort);
    if (port.startsWith('::')) {
      rest.push(port);
    } else {
      preferred.push(port);
    }
  }

  // If only IPv6 form existed, keep it
  for (const port of rest) {
    const hostPort = port.match(/(?:^|:)(\d+)->/)?.[1];
    if (!hostPort || preferred.some((p) => p.includes(`:${hostPort}->`) || p.startsWith(`${hostPort}->`))) {
      continue;
    }
    preferred.push(port);
  }

  return preferred.length > 0 ? preferred : ports;
}
