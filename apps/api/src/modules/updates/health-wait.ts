import type { IDockerClient } from '../../domain/ports.js';

const DEFAULT_TIMEOUT_MS = 180_000;
const POLL_MS = 2_000;
/** Containers without a healthcheck must stay up this long (same start) before we call it good. */
const NO_HEALTHCHECK_GRACE_MS = 12_000;

export async function waitForContainerHealthy(
  docker: IDockerClient,
  containerIdOrName: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  graceMs = NO_HEALTHCHECK_GRACE_MS,
): Promise<{ ok: boolean; message: string }> {
  const deadline = Date.now() + timeoutMs;
  const wanted = containerIdOrName.replace(/^\//, '');
  let stableSince: { startedAt: string | undefined; at: number } | null = null;
  let lastState = 'unknown';

  while (Date.now() < deadline) {
    try {
      const details = await docker.inspectContainer(wanted);
      lastState = details.state;
      if (details.state !== 'running') {
        stableSince = null;
        // A container that exited on its own (not restarting) will not come back.
        if (details.state === 'exited' || details.state === 'dead') {
          return {
            ok: false,
            message: `Container ${details.name} stopped (exit code ${details.exitCode ?? '?'})`,
          };
        }
        await sleep(POLL_MS);
        continue;
      }

      const health = details.health;
      if (health === 'healthy') {
        return { ok: true, message: `Container healthy (${details.name})` };
      }
      if (health === 'unhealthy') {
        return { ok: false, message: `Container unhealthy (${details.name})` };
      }
      if (!health || health === 'none') {
        // No healthcheck: require it to keep running without a restart for the grace period,
        // so a crash a few seconds after start still triggers the rollback.
        if (!stableSince || stableSince.startedAt !== details.startedAt) {
          stableSince = { startedAt: details.startedAt, at: Date.now() };
        } else if (Date.now() - stableSince.at >= graceMs) {
          return { ok: true, message: `Container running (${details.name})` };
        }
      }
    } catch {
      // retry
    }
    await sleep(POLL_MS);
  }

  return {
    ok: false,
    message: `Healthcheck timeout after ${Math.round(timeoutMs / 1000)}s (state: ${lastState})`,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
