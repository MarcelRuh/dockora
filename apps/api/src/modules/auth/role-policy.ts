import type { UserRole } from '@dockora/shared';

/** Admin-only mutations (delete, restore, settings, host). */
export const ADMIN_ROLES: UserRole[] = ['admin'];

/** Operator + admin: lifecycle ops that the UI already gates with `canOperate`. */
export const OPERATOR_ROLES: UserRole[] = ['admin', 'operator'];

const CONTAINER_OPERATOR_ACTIONS = new Set([
  'start',
  'stop',
  'restart',
  'pause',
  'unpause',
]);

const CONTAINER_ADMIN_ACTIONS = new Set(['kill', 'remove']);

const COMPOSE_OPERATOR_ACTIONS = new Set(['up', 'start', 'stop', 'restart', 'pull', 'build', 'recreate']);
const COMPOSE_ADMIN_ACTIONS = new Set(['down']);

/**
 * Fail closed: unknown actions require admin.
 * Viewers never get write access through these endpoints.
 */
export function rolesForContainerAction(action: string): UserRole[] {
  if (CONTAINER_OPERATOR_ACTIONS.has(action)) return OPERATOR_ROLES;
  if (CONTAINER_ADMIN_ACTIONS.has(action)) return ADMIN_ROLES;
  return ADMIN_ROLES;
}

export function rolesForComposeAction(action: string): UserRole[] {
  if (COMPOSE_OPERATOR_ACTIONS.has(action)) return OPERATOR_ROLES;
  if (COMPOSE_ADMIN_ACTIONS.has(action)) return ADMIN_ROLES;
  return ADMIN_ROLES;
}
