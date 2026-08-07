/** Parse Docker port strings like `8080->80/tcp` or `127.0.0.1:5055->5055/tcp`. */
export function publishedPortHref(
  portMapping: string,
  pageHost: string,
): { label: string; href: string | null } {
  const match = portMapping.match(/^(?:(\[[^\]]+\]|[^:[\]]+):)?(\d+)->(\d+)\/(\w+)$/);
  if (!match) {
    return { label: portMapping, href: null };
  }

  const bindIp = match[1];
  const hostPort = match[2]!;
  const proto = match[4]!.toLowerCase();

  if (proto !== 'tcp') {
    return { label: portMapping, href: null };
  }

  let host = pageHost;
  if (bindIp && bindIp !== '0.0.0.0' && bindIp !== '::' && bindIp !== '[::]') {
    const normalized = bindIp.replace(/^\[|\]$/g, '');
    // Loopback binds are only reachable on the Docker host itself –
    // still use the browser host so LAN users get a usable link.
    if (normalized !== '127.0.0.1' && normalized !== '::1') {
      host = normalized.includes(':') ? `[${normalized}]` : normalized;
    }
  }

  return {
    label: String(hostPort),
    href: `http://${host}:${hostPort}`,
  };
}
