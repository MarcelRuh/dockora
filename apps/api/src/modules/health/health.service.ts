import { APP_VERSION, type HealthResponse } from '@dockora/shared';
import type { IDockerClient } from '../../domain/ports.js';

const startedAt = Date.now();

export class HealthService {
  constructor(private readonly docker: IDockerClient) {}

  async getHealth(): Promise<HealthResponse> {
    let connected = false;
    let engineVersion: string | undefined;

    try {
      connected = await this.docker.ping();
      if (connected) {
        const version = await this.docker.getVersion();
        engineVersion = version.version;
      }
    } catch {
      connected = false;
    }

    const status: HealthResponse['status'] = connected ? 'ok' : 'degraded';

    return {
      status,
      version: APP_VERSION,
      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
      timestamp: new Date().toISOString(),
      docker: {
        connected,
        engineVersion,
      },
    };
  }
}
