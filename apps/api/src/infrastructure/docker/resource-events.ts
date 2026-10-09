import type { DockerResourceChange } from '../../domain/ports.js';

export type { DockerResourceChange };

const NOISY_ACTIONS = new Set([
  'exec_create',
  'exec_start',
  'exec_die',
  'attach',
  'detach',
  'resize',
  'top',
  'export',
  'commit',
  'copy',
  'archive-path',
  'extract-to-dir',
  /** Frequent health probes must not flush list/compose/dashboard caches. */
  'health_status',
]);

/** Container actions that can change Compose project membership or paths. */
const COMPOSE_DISCOVERY_ACTIONS = new Set([
  'create',
  'destroy',
  'die',
  'kill',
  'start',
  'stop',
  'restart',
  'rename',
  'update',
  'pause',
  'unpause',
]);

const LIVE_STATUSES = new Set(['running', 'paused', 'restarting']);

export function dockerActionName(action: string): string {
  return (action.split(':')[0] ?? action).toLowerCase();
}

export function isNoisyDockerAction(action: string): boolean {
  return NOISY_ACTIONS.has(dockerActionName(action));
}

export function affectsComposeDiscovery(action: string): boolean {
  return COMPOSE_DISCOVERY_ACTIONS.has(dockerActionName(action));
}

export function isLiveContainerStatus(status: string): boolean {
  return LIVE_STATUSES.has(status);
}
