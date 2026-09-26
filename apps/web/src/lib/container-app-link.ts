import { publishedPortHref, uniquePublishedPorts } from './published-ports';

const URL_LABELS = ['url', 'dockora.url', 'homepage.href', 'net.unraid.docker.webui'] as const;
const PUBLIC_LABELS = ['public_url', 'dockora.publicUrl'] as const;

/** Host ports that are almost never the web UI (DNS, NTP, SSH, NFS). */
const NON_WEB_HOST_PORTS = new Set(['22', '53', '67', '68', '123', '873', '1900', '2049', '5353']);

/**
 * App tile target: an explicit URL label, otherwise the first published TCP port,
 * otherwise the container detail page.
 */
export function resolveContainerAppHref(
  input: { id: string; labels?: Record<string, string> | null; ports: string[] },
  pageHost: string,
): { href: string; external: boolean } {
  const labeled = labeledAppUrl(input.labels, input.ports, pageHost);
  if (labeled) return { href: labeled, external: true };

  const host = pageHost || 'localhost';
  const published = uniquePublishedPorts(input.ports)
    .map((port) => ({ port, ...publishedPortHref(port, host) }))
    .filter((item): item is { port: string; href: string; label: string; hostPort: string | null } => Boolean(item.href));
  const web = published.filter((item) => item.hostPort && !NON_WEB_HOST_PORTS.has(item.hostPort));
  const chosen = pickWebPort(web.length > 0 ? web : published);
  if (chosen?.href) return { href: chosen.href, external: true };

  return { href: `/containers/${encodeURIComponent(input.id)}`, external: false };
}

/**
 * Public address: a saved override wins, including an empty string that hides
 * a URL discovered from the Compose .env. Otherwise labels, then discovery.
 */
export function resolvePublicAppUrl(
  name: string,
  labels: Record<string, string> | null | undefined,
  overrides: Record<string, string>,
  discovered: Record<string, string>,
): string | null {
  if (Object.prototype.hasOwnProperty.call(overrides, name)) {
    return httpUrl(overrides[name]);
  }
  for (const key of PUBLIC_LABELS) {
    const labeled = httpUrl(labels?.[key]);
    if (labeled) return labeled;
  }
  return httpUrl(discovered[name]);
}

function httpUrl(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return /^https?:\/\//i.test(trimmed) ? trimmed : null;
}

function pickWebPort<T extends { port: string; href: string | null; hostPort: string | null }>(
  ports: T[],
): T | undefined {
  if (ports.length <= 1) return ports[0];
  const plainHttp = ports.filter((item) => item.hostPort === '80' || item.hostPort === '443');
  const others = ports.filter((item) => item.hostPort !== '80' && item.hostPort !== '443');
  if (plainHttp.length > 0 && others.length > 0) return others[0];
  return ports.find((item) => /->(?:80|443|8080|8443)\//.test(item.port)) ?? ports[0];
}

function labeledAppUrl(
  labels: Record<string, string> | null | undefined,
  ports: string[],
  pageHost: string,
): string | null {
  if (!labels) return null;
  const host = pageHost || 'localhost';
  for (const key of URL_LABELS) {
    const raw = labels[key]?.trim();
    if (!raw) continue;
    const expanded = expandWebuiTemplate(raw, ports, host);
    if (/^https?:\/\//i.test(expanded)) return expanded;
  }
  return null;
}

/** Unraid-style `http://[IP]:[PORT:32400]/web`. */
function expandWebuiTemplate(raw: string, ports: string[], pageHost: string): string {
  let value = raw.replaceAll('[IP]', pageHost);
  value = value.replace(/\[PORT:(\d+)\]/g, (_match, containerPort: string) => {
    const mapped = uniquePublishedPorts(ports).find((port) => port.includes(`->${containerPort}/`));
    if (!mapped) return containerPort;
    return publishedPortHref(mapped, pageHost).hostPort ?? containerPort;
  });
  return value;
}
