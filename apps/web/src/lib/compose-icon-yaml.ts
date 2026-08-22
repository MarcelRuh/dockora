const SERVICE_RE = /^  ([A-Za-z0-9][A-Za-z0-9._-]*):\s*(?:#.*)?$/;
const NEXT_BLOCK = /^(  [A-Za-z0-9][A-Za-z0-9._-]*:|\S)/;

/**
 * Insert or replace `icon=` (list form) under a Compose service.
 * Empty url removes existing icon labels for that service.
 */
export function setComposeServiceIcon(yaml: string, service: string, url: string): string {
  const lines = yaml.split(/\r?\n/);
  const start = lines.findIndex((line) => {
    const m = SERVICE_RE.exec(line.replace(/\t/g, '  '));
    return m?.[1] === service;
  });
  if (start < 0) throw new Error(`Service "${service}" not found`);

  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i]!.replace(/\t/g, '  ');
    if (NEXT_BLOCK.test(line) && !line.startsWith('    ')) {
      end = i;
      break;
    }
  }

  const block = lines.slice(start, end);
  const iconList = /^\s{4,}-\s+(?:icon|[\w.]+\.icon)=/i;
  const iconMap = /^\s{4,}(?:icon|[\w.]+\.icon)\s*:/i;
  const labelsHeader = /^\s{4}labels:\s*(?:#.*)?$/;

  const nextUrl = url.trim();
  const filtered = block.filter((line) => !iconList.test(line) && !iconMap.test(line));

  if (!nextUrl) {
    return [...lines.slice(0, start), ...filtered, ...lines.slice(end)].join('\n');
  }

  const labelIdx = filtered.findIndex((line) => labelsHeader.test(line.replace(/\t/g, '  ')));
  const iconLine = `      - icon=${nextUrl}`;
  if (labelIdx >= 0) {
    filtered.splice(labelIdx + 1, 0, iconLine);
  } else {
    filtered.splice(1, 0, '    labels:', iconLine);
  }

  return [...lines.slice(0, start), ...filtered, ...lines.slice(end)].join('\n');
}

export function selfhstIconUrl(slug: string): string {
  return `https://cdn.jsdelivr.net/gh/selfhst/icons/png/${slug}.png`;
}
