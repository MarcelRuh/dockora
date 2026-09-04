import { describe, expect, it } from 'vitest';
import { canAdmin, canOperate } from './roles';

describe('roles', () => {
  it('allows everyone when auth is off', () => {
    expect(canOperate('viewer', false)).toBe(true);
    expect(canAdmin('viewer', false)).toBe(true);
  });

  it('restricts operators and viewers when auth is on', () => {
    expect(canOperate('operator', true)).toBe(true);
    expect(canOperate('viewer', true)).toBe(false);
    expect(canAdmin('admin', true)).toBe(true);
    expect(canAdmin('operator', true)).toBe(false);
  });
});
