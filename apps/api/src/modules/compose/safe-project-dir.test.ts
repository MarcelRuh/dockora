import { describe, expect, it } from 'vitest';
import { assertSafeProjectDir, UnsafeProjectPathError } from './safe-project-dir.js';

describe('assertSafeProjectDir', () => {
  const search = ['/home', '/opt', '/srv'];

  it('allows project subdirs under search paths', () => {
    expect(() => assertSafeProjectDir('/home/plex', search)).not.toThrow();
    expect(() => assertSafeProjectDir('/home/arr-stack', search)).not.toThrow();
  });

  it('blocks search roots and system paths', () => {
    expect(() => assertSafeProjectDir('/home', search)).toThrow(UnsafeProjectPathError);
    expect(() => assertSafeProjectDir('/', search)).toThrow(UnsafeProjectPathError);
    expect(() => assertSafeProjectDir('/opt/dockora', search)).toThrow(UnsafeProjectPathError);
  });

  it('blocks paths outside search roots', () => {
    expect(() => assertSafeProjectDir('/tmp/evil', search)).toThrow(UnsafeProjectPathError);
  });
});
