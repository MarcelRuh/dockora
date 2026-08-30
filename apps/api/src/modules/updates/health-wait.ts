import type { IDockerClient } from '../../domain/ports.js';

const DEFAULT_TIMEOUT_MS = 90_000;
const POLL_MS = 2_000;

export async function waitForContainerHealthy(
  docker: IDockerClient,
  containerIdOrName: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<{ ok: boolean; message: string }> {
  const deadline = Date.now() + timeoutMs;
  const wanted = containerIdOrName.replace(/^\//, '');

  while (Date.now() < deadline) {
    try {
      const details = await docker.inspectContainer(wanted);
      if (details.state !== 'running') {
        await sleep(POLL_MS);
        continue;
      }

      const health = details.health;
      if (!health || health === 'none' || health === 'healthy') {
        return { ok: true, message: `Container healthy (${details.name})` };
      }
      if (health === 'unhealthy') {
        return { ok: false, message: `Container unhealthy (${details.name})` };
      }
    } catch {
      // retry
    }
    await sleep(POLL_MS);
  }

  return { ok: false, message: `Healthcheck timeout after ${timeoutMs}ms` };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
