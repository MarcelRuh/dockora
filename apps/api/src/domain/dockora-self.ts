/**
 * Erkennt Dockora-eigene Container/Images, damit die Suite sich in
 * Listen (Container, Images, Updates) ausblendet – Monitoring bleibt ungefiltert.
 */

const SELF_CONTAINER_NAMES = new Set([
  'dockora-api',
  'dockora-web',
  'dockora-proxy',
  'dockora-self-updater',
]);

/** com.docker.compose.project – Standard aus .env COMPOSE_PROJECT_NAME */
const SELF_COMPOSE_PROJECTS = new Set(['dockora']);

/**
 * Repo/Tag gehört zur Dockora-Suite (auch ghcr.io/.../dockora-api:1.2.0).
 */
export function isDockoraSelfImageRef(ref: string): boolean {
  const normalized = ref.trim().toLowerCase();
  if (!normalized || normalized === '<none>:<none>' || normalized === '<none>') {
    return false;
  }
  const withoutDigest = normalized.split('@')[0] ?? normalized;
  const repo = (withoutDigest.split(':')[0] ?? withoutDigest).replace(/\/+$/, '');
  const shortName = repo.includes('/') ? (repo.split('/').pop() ?? repo) : repo;

  if (shortName === 'dockora' || shortName.startsWith('dockora-')) return true;
  // Pfad-Segmente: …/dockora/… oder …/dockora-api
  if (/(^|\/)dockora(-[a-z0-9._]+)?(\/|$)/i.test(repo)) return true;
  return false;
}

export function isDockoraSelfImageTags(tags: string[]): boolean {
  if (tags.length === 0) return false;
  return tags.some((tag) => isDockoraSelfImageRef(tag));
}

export function isDockoraSelfContainer(input: {
  name: string;
  image?: string;
  composeProject?: string | null;
  labels?: Record<string, string>;
}): boolean {
  const name = stripLeadingSlash(input.name).toLowerCase();
  if (SELF_CONTAINER_NAMES.has(name)) return true;
  if (name.startsWith('dockora-')) return true;

  const project =
    input.composeProject?.toLowerCase() ||
    input.labels?.['com.docker.compose.project']?.toLowerCase();
  if (project && SELF_COMPOSE_PROJECTS.has(project)) return true;

  if (input.image && isDockoraSelfImageRef(input.image)) return true;
  return false;
}

/** Compose-Projekt der Dockora-Suite (Name oder Install-Pfad). */
export function isDockoraSelfComposeProject(input: {
  name: string;
  path?: string;
}): boolean {
  const name = input.name.trim().toLowerCase();
  if (SELF_COMPOSE_PROJECTS.has(name) || name === 'dockora') return true;

  const p = (input.path ?? '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  if (!p) return false;
  if (p === '/opt/dockora' || p === '/dockora-install') return true;
  if (p.endsWith('/dockora')) return true;
  return false;
}

/**
 * Image nur von Dockora-Containern genutzt (z. B. nginx für dockora-proxy).
 * Unbenutzte Images bleiben sichtbar.
 */
export function isImageUsedOnlyByDockoraSelf(
  usedByNames: string[],
  selfContainerNames: ReadonlySet<string>,
): boolean {
  if (usedByNames.length === 0) return false;
  return usedByNames.every((n) => selfContainerNames.has(stripLeadingSlash(n).toLowerCase()));
}

function stripLeadingSlash(name: string): string {
  return name.startsWith('/') ? name.slice(1) : name;
}
