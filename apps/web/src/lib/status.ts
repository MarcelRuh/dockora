import type { ContainerStatus } from '@dockora/shared';

export function containerStatusTone(
  status: ContainerStatus,
): 'success' | 'warning' | 'danger' | 'muted' | 'info' {
  switch (status) {
    case 'running':
      return 'success';
    case 'paused':
    case 'restarting':
      return 'warning';
    case 'exited':
    case 'dead':
      return 'danger';
    case 'created':
      return 'info';
    default:
      return 'muted';
  }
}

export function composeStatusTone(
  status: string,
): 'success' | 'warning' | 'danger' | 'muted' | 'info' {
  switch (status) {
    case 'running':
      return 'success';
    case 'partial':
      return 'warning';
    case 'stopped':
      return 'muted';
    default:
      return 'info';
  }
}

export function logLevelTone(level: string): 'success' | 'warning' | 'danger' | 'muted' | 'info' {
  switch (level) {
    case 'error':
      return 'danger';
    case 'warn':
      return 'warning';
    case 'info':
      return 'info';
    case 'debug':
      return 'muted';
    default:
      return 'muted';
  }
}

export function shortId(id: string): string {
  return id.length > 12 ? id.slice(0, 12) : id;
}
