import { APP_VERSION } from '@dockora/shared';
import type { IDockerClient } from '../../domain/ports.js';
import { apiRepositoryPath, parseImageRef, pickDigest } from '../updates/registry.js';
import { request } from 'undici';

export interface SelfUpdateStatus {
  enabled: boolean;
  currentVersion: string;
  image: string | null;
  currentDigest: string | null;
  remoteDigest: string | null;
  updateAvailable: boolean;
  message: string;
}

export interface SelfUpdateApplyResult {
  ok: boolean;
  message: string;
}

/**
 * Self-Update für das Dockora-API-Image (nicht Gast-Container).
 * Pull nur – Restart erfolgt bewusst manuell / per Compose.
 */
export class SelfUpdateService {
  constructor(
    private readonly docker: IDockerClient,
    private readonly image: string | null,
  ) {}

  async status(): Promise<SelfUpdateStatus> {
    if (!this.image) {
      return {
        enabled: false,
        currentVersion: APP_VERSION,
        image: null,
        currentDigest: null,
        remoteDigest: null,
        updateAvailable: false,
        message:
          'Self-Update deaktiviert – DOCKORA_SELF_IMAGE setzen (z. B. ghcr.io/org/dockora-api:latest)',
      };
    }

    const parsed = parseImageRef(this.image);
    let currentDigest: string | null = null;
    let remoteDigest: string | null = null;
    let message = 'Up to date';

    try {
      const inspect = await this.docker.getImageInspect(this.image);
      currentDigest = pickDigest(inspect.RepoDigests, parsed);
    } catch {
      message = 'Lokales Image nicht gefunden – Pull erforderlich';
    }

    try {
      remoteDigest = await fetchRemoteDigestSimple(parsed);
    } catch (error) {
      return {
        enabled: true,
        currentVersion: APP_VERSION,
        image: this.image,
        currentDigest,
        remoteDigest: null,
        updateAvailable: false,
        message: `Remote-Check fehlgeschlagen: ${error instanceof Error ? error.message : String(error)}`,
      };
    }

    const updateAvailable =
      Boolean(remoteDigest && currentDigest && remoteDigest !== currentDigest) ||
      (!currentDigest && Boolean(remoteDigest));

    return {
      enabled: true,
      currentVersion: APP_VERSION,
      image: this.image,
      currentDigest,
      remoteDigest,
      updateAvailable,
      message: updateAvailable
        ? 'Update verfügbar – Pull ausführen, danach Dockora-Stack neu starten'
        : message,
    };
  }

  async apply(): Promise<SelfUpdateApplyResult> {
    if (!this.image) {
      return { ok: false, message: 'DOCKORA_SELF_IMAGE ist nicht gesetzt' };
    }

    try {
      await this.docker.pullImage(this.image);
      const after = await this.status();
      return {
        ok: true,
        message: `Image ${this.image} aktualisiert (${after.currentDigest?.slice(0, 19) ?? 'ok'}). Bitte Dockora neu starten (compose up -d).`,
      };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

async function fetchRemoteDigestSimple(
  parsed: ReturnType<typeof parseImageRef>,
): Promise<string | null> {
  const repoPath = apiRepositoryPath(parsed);
  let registryHost = parsed.registryHost || 'registry-1.docker.io';
  let token: string | undefined;

  if (parsed.registry === 'dockerhub') {
    registryHost = 'registry-1.docker.io';
    const tokenUrl = `https://auth.docker.io/token?service=registry.docker.io&scope=repository:${repoPath}:pull`;
    const tokenRes = await request(tokenUrl);
    if (tokenRes.statusCode < 400) {
      const body = (await tokenRes.body.json()) as { token?: string; access_token?: string };
      token = body.token ?? body.access_token;
    }
  } else {
    try {
      const tokenUrl = `https://${registryHost}/token?service=${registryHost}&scope=repository:${repoPath}:pull`;
      const tokenRes = await request(tokenUrl);
      if (tokenRes.statusCode < 400) {
        const body = (await tokenRes.body.json()) as { token?: string; access_token?: string };
        token = body.token ?? body.access_token;
      }
    } catch {
      // anonymous
    }
  }

  const url = `https://${registryHost}/v2/${repoPath}/manifests/${parsed.tag}`;
  const headers: Record<string, string> = {
    Accept:
      'application/vnd.docker.distribution.manifest.v2+json, application/vnd.oci.image.manifest.v1+json',
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await request(url, { headers });
  if (res.statusCode >= 400) {
    throw new Error(`Manifest fetch failed (${res.statusCode})`);
  }
  const digestHeader = res.headers['docker-content-digest'];
  return typeof digestHeader === 'string' ? digestHeader : null;
}
