import { describe, expect, it } from 'vitest';
import {
  ADMIN_ROLES,
  OPERATOR_ROLES,
  rolesForComposeAction,
  rolesForContainerAction,
} from './role-policy.js';

describe('role policy', () => {
  it('keeps viewers off operator and admin role lists', () => {
    expect(OPERATOR_ROLES).toEqual(['admin', 'operator']);
    expect(ADMIN_ROLES).toEqual(['admin']);
    expect(OPERATOR_ROLES).not.toContain('viewer');
    expect(ADMIN_ROLES).not.toContain('viewer');
    expect(ADMIN_ROLES).not.toContain('operator');
  });

  it.each(['start', 'stop', 'restart', 'pause', 'unpause'] as const)(
    'container %s requires operator+',
    (action) => {
      expect(rolesForContainerAction(action)).toEqual(OPERATOR_ROLES);
    },
  );

  it.each(['kill', 'remove'] as const)('container %s requires admin', (action) => {
    expect(rolesForContainerAction(action)).toEqual(ADMIN_ROLES);
  });

  it('unknown container actions fail closed as admin', () => {
    expect(rolesForContainerAction('explode')).toEqual(ADMIN_ROLES);
  });

  it.each(['up', 'start', 'stop', 'restart', 'pull', 'build', 'recreate'] as const)(
    'compose %s requires operator+',
    (action) => {
      expect(rolesForComposeAction(action)).toEqual(OPERATOR_ROLES);
    },
  );

  it('compose down requires admin', () => {
    expect(rolesForComposeAction('down')).toEqual(ADMIN_ROLES);
  });

  it('unknown compose actions fail closed as admin', () => {
    expect(rolesForComposeAction('logs')).toEqual(ADMIN_ROLES);
    expect(rolesForComposeAction('wipe')).toEqual(ADMIN_ROLES);
  });
});
