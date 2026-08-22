import type { UserRole } from '@dockora/shared';

/** Wenn Auth aus ist, gelten alle Aktionen als erlaubt. */
export function canOperate(role: UserRole | null | undefined, authEnabled: boolean): boolean {
  if (!authEnabled) return true;
  return role === 'admin' || role === 'operator';
}

export function canAdmin(role: UserRole | null | undefined, authEnabled: boolean): boolean {
  if (!authEnabled) return true;
  return role === 'admin';
}
