import type { RegistryProvider } from '@dockora/shared';

export interface ParsedImageRef {
  registry: RegistryProvider;
  registryHost: string;
  namespace: string;
  repository: string;
  tag: string;
  /** Vollständiger Image-Name für Registry-API (ohne Tag) */
  repositoryPath: string;
}

const DEFAULT_REGISTRY = 'docker.io';
const LIBRARY_PREFIX = 'library/';

/**
 * Erkennt Registry-Anbieter und zerlegt Image-Referenzen.
 * - docker.io / kein Slash oder library/* → dockerhub
 * - ghcr.io → ghcr
 * - quay.io → quay
 * - gitlab.* / gitea.* → gitlab / gitea
 * - sonst → private
 */
export function detectRegistry(imageRef: string): RegistryProvider {
  return parseImageRef(imageRef).registry;
}

export function parseImageRef(imageRef: string): ParsedImageRef {
  const trimmed = imageRef.trim();
  const withoutDigest = trimmed.split('@')[0] ?? trimmed;

  let remainder = withoutDigest;
  let registryHost = DEFAULT_REGISTRY;

  const firstSlash = remainder.indexOf('/');
  const hasRegistry = firstSlash > 0 && (remainder.slice(0, firstSlash).includes('.') || remainder.slice(0, firstSlash).includes(':'));

  if (hasRegistry) {
    registryHost = remainder.slice(0, firstSlash).toLowerCase();
    remainder = remainder.slice(firstSlash + 1);
  }

  const registry = resolveProvider(registryHost, remainder);

  const colonIdx = remainder.lastIndexOf(':');
  const hasTag = colonIdx > 0 && !remainder.slice(colonIdx + 1).includes('/');
  const tag = hasTag ? remainder.slice(colonIdx + 1) : 'latest';
  const namePart = hasTag ? remainder.slice(0, colonIdx) : remainder;

  let namespace: string;
  let repository: string;

  if (namePart.includes('/')) {
    const slash = namePart.indexOf('/');
    namespace = namePart.slice(0, slash);
    repository = namePart.slice(slash + 1);
  } else if (registry === 'dockerhub') {
    namespace = 'library';
    repository = namePart;
  } else {
    namespace = 'default';
    repository = namePart;
  }

  const repoPrefix =
    registry === 'dockerhub' && namespace === 'library'
      ? `${repository}`
      : `${namespace}/${repository}`;

  return {
    registry,
    registryHost: normalizeRegistryHost(registry, registryHost),
    namespace,
    repository,
    tag,
    repositoryPath: repoPrefix,
  };
}

function resolveProvider(registryHost: string, remainder: string): RegistryProvider {
  const host = registryHost.toLowerCase();

  if (host === 'docker.io' || host === 'index.docker.io' || host === 'registry-1.docker.io') {
    return 'dockerhub';
  }
  if (host === 'ghcr.io') {
    return 'ghcr';
  }
  // LinuxServer Container Registry is a GHCR front-end
  if (host === 'lscr.io') {
    return 'ghcr';
  }
  if (host === 'quay.io') {
    return 'quay';
  }
  if (host.includes('gitlab') || host.endsWith('.gitlab.io')) {
    return 'gitlab';
  }
  if (host.includes('gitea')) {
    return 'gitea';
  }
  if (!remainder.includes('/') && !host.includes('.')) {
    return 'dockerhub';
  }
  return 'private';
}

function normalizeRegistryHost(provider: RegistryProvider, host: string): string {
  if (provider === 'dockerhub') {
    return 'registry-1.docker.io';
  }
  return host;
}

/** Docker Hub library images brauchen library/-Präfix in der API */
export function apiRepositoryPath(parsed: ParsedImageRef): string {
  if (parsed.registry === 'dockerhub' && parsed.namespace === 'library') {
    return `${LIBRARY_PREFIX}${parsed.repository}`;
  }
  return `${parsed.namespace}/${parsed.repository}`;
}

/** Extrahiert sha256-Digest aus RepoDigests-Eintrag */
export function extractDigest(repoDigest: string | undefined): string | null {
  if (!repoDigest) return null;
  const atIdx = repoDigest.indexOf('@');
  if (atIdx >= 0) {
    return repoDigest.slice(atIdx + 1);
  }
  if (repoDigest.startsWith('sha256:')) {
    return repoDigest;
  }
  return repoDigest;
}

/** Wählt besten Digest aus RepoDigests passend zur Image-Referenz */
export function pickDigest(
  repoDigests: string[] | undefined,
  parsed: ParsedImageRef,
): string | null {
  if (!repoDigests?.length) return null;

  const hostPrefix = parsed.registryHost.replace('registry-1.', '');
  const candidates = [
    `${parsed.registryHost}/${parsed.repositoryPath}`,
    `${hostPrefix}/${parsed.repositoryPath}`,
    parsed.repositoryPath,
  ];

  for (const prefix of candidates) {
    const match = repoDigests.find((d) => d.startsWith(`${prefix}@`));
    if (match) return extractDigest(match);
  }

  return extractDigest(repoDigests[0]);
}
