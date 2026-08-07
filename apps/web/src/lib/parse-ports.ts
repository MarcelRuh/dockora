/**
 * Parse Docker port strings as produced by Dockora's formatPorts:
 * - "8080->80/tcp"
 * - "127.0.0.1:8080->80/tcp"
 * - ":::3000->3000/tcp" (IPv6 all-interfaces)
 * - "80/tcp" (internal only)
 */

export interface ParsedPort {
  raw: string;
  published: boolean;
  hostIp: string | null;
  hostPort: string | null;
  containerPort: string;
  protocol: string;
}

export function parsePortBinding(raw: string): ParsedPort | null {
  const value = raw.trim();
  if (!value) return null;

  const arrow = value.indexOf('->');
  if (arrow === -1) {
    const internal = /^(\d+)\/([a-zA-Z0-9]+)$/.exec(value);
    if (!internal) return null;
    return {
      raw: value,
      published: false,
      hostIp: null,
      hostPort: null,
      containerPort: internal[1]!,
      protocol: internal[2]!.toLowerCase(),
    };
  }

  const left = value.slice(0, arrow);
  const right = value.slice(arrow + 2);
  const rightMatch = /^(\d+)\/([a-zA-Z0-9]+)$/.exec(right);
  if (!rightMatch) return null;

  const containerPort = rightMatch[1]!;
  const protocol = rightMatch[2]!.toLowerCase();

  // "8080" | "127.0.0.1:8080" | ":::8080" | "[::1]:8080"
  const withIp = /^(.*):(\d+)$/.exec(left);
  if (withIp) {
    return {
      raw: value,
      published: true,
      hostIp: withIp[1] || null,
      hostPort: withIp[2]!,
      containerPort,
      protocol,
    };
  }

  if (/^\d+$/.test(left)) {
    return {
      raw: value,
      published: true,
      hostIp: null,
      hostPort: left,
      containerPort,
      protocol,
    };
  }

  return null;
}

export function parsePortBindings(ports: string[]): ParsedPort[] {
  const out: ParsedPort[] = [];
  for (const p of ports) {
    const parsed = parsePortBinding(p);
    if (parsed) out.push(parsed);
  }
  return out;
}

export function formatHostBinding(port: ParsedPort): string {
  if (!port.published || !port.hostPort) return port.raw;
  if (!port.hostIp || port.hostIp === '0.0.0.0' || port.hostIp === '::' || port.hostIp === ':::') {
    return `:${port.hostPort}`;
  }
  return `${port.hostIp}:${port.hostPort}`;
}

/** Dedupe IPv4/IPv6 dual publishes of the same host port on one container. */
export function uniquePublishedPorts(ports: ParsedPort[]): ParsedPort[] {
  const seen = new Set<string>();
  const out: ParsedPort[] = [];
  for (const p of ports.filter((x) => x.published)) {
    const key = `${p.hostPort}|${p.containerPort}|${p.protocol}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}
