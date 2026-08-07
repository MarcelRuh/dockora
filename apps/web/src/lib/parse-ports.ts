/**
 * Parse Docker port strings as produced by Dockora's formatPorts:
 * - "8080->80/tcp"
 * - "127.0.0.1:8080->80/tcp"
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

const PUBLISHED_RE =
  /^(?:((?:\d{1,3}\.){3}\d{1,3}|\[?[0-9a-fA-F:]+\]?):)?(\d+)->(\d+)\/([a-zA-Z0-9]+)$/;
const INTERNAL_RE = /^(\d+)\/([a-zA-Z0-9]+)$/;

export function parsePortBinding(raw: string): ParsedPort | null {
  const value = raw.trim();
  if (!value) return null;

  const published = PUBLISHED_RE.exec(value);
  if (published) {
    return {
      raw: value,
      published: true,
      hostIp: published[1] ?? null,
      hostPort: published[2]!,
      containerPort: published[3]!,
      protocol: published[4]!.toLowerCase(),
    };
  }

  const internal = INTERNAL_RE.exec(value);
  if (internal) {
    return {
      raw: value,
      published: false,
      hostIp: null,
      hostPort: null,
      containerPort: internal[1]!,
      protocol: internal[2]!.toLowerCase(),
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
  return port.hostIp ? `${port.hostIp}:${port.hostPort}` : `:${port.hostPort}`;
}
