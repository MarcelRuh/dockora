/** Canonical Dockora icon label, then vendor fallbacks (Arcane/Unraid/Homarr). */
const ICON_LABEL_KEYS = [
  'icon',
  'dockora.icon',
  'com.getarcaneapp.arcane.icon',
  'net.unraid.docker.icon',
  'org.homarr.icon',
  'homepage.icon',
] as const;

/**
 * Resolves a http(s) icon URL from container labels (e.g. Compose `icon=https://…/seerr.png`).
 */
export function resolveContainerIconUrl(
  labels: Record<string, string> | null | undefined,
): string | null {
  if (!labels) return null;
  for (const key of ICON_LABEL_KEYS) {
    const value = labels[key]?.trim();
    if (value && /^https?:\/\//i.test(value)) {
      return value;
    }
  }
  return null;
}

/**
 * Parse service → icon URL from Compose YAML labels (list or map form).
 */
export function extractComposeServiceIcons(yaml: string): Record<string, string> {
  const out: Record<string, string> = {};
  const lines = yaml.split(/\r?\n/);
  let inServices = false;
  let currentService: string | null = null;

  for (const raw of lines) {
    const line = raw.replace(/\t/g, '  ');
    if (/^services:\s*(?:#.*)?$/.test(line)) {
      inServices = true;
      currentService = null;
      continue;
    }
    if (inServices && /^\S/.test(line) && !line.startsWith('#')) {
      inServices = false;
      currentService = null;
    }
    if (!inServices) continue;

    const serviceMatch = line.match(/^  ([a-zA-Z0-9][a-zA-Z0-9_-]*):\s*(?:#.*)?$/);
    if (serviceMatch) {
      currentService = serviceMatch[1]!;
      continue;
    }

    if (!currentService) continue;

    for (const key of ICON_LABEL_KEYS) {
      const escaped = key.replace(/\./g, '\\.');
      const listForm = line.match(
        new RegExp(`${escaped}=((?:https?:\\/\\/)\\S+?)(?:\\s|$|["'])`),
      );
      const mapForm = line.match(
        new RegExp(`${escaped}\\s*:\\s*["']?((?:https?:\\/\\/)\\S+?)["']?\\s*$`),
      );
      const url = (listForm?.[1] ?? mapForm?.[1])?.replace(/[,]+$/, '');
      if (url && /^https?:\/\//i.test(url)) {
        out[currentService] = url;
        break;
      }
    }
  }

  return out;
}
