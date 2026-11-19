import { describe, expect, it } from 'vitest';
import { isImageIdRef } from './image-ref.js';

describe('isImageIdRef', () => {
  it('detects bare image IDs', () => {
    expect(isImageIdRef('sha256:9cdfebbcbb6a70b84c538e6e39862c5d627171e5f4ea4bfda933f7643e3640a4')).toBe(true);
    expect(isImageIdRef('9cdfebbcbb6a')).toBe(true);
  });
  it('keeps real references', () => {
    expect(isImageIdRef('jc21/nginx-proxy-manager:latest')).toBe(false);
    expect(isImageIdRef('nginx@sha256:9cdfebbcbb6a70b84c538e6e39862c5d627171e5f4ea4bfda933f7643e3640a4')).toBe(false);
    expect(isImageIdRef('adguard')).toBe(false);
    expect(isImageIdRef(undefined)).toBe(false);
  });
});
