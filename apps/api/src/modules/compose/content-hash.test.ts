import { describe, expect, it } from 'vitest';
import { contentHash } from './content-hash.js';

describe('contentHash', () => {
  it('returns a stable sha256 hex digest', () => {
    expect(contentHash('services:\n  web:\n    image: nginx\n')).toBe(
      contentHash('services:\n  web:\n    image: nginx\n'),
    );
    expect(contentHash('a')).not.toBe(contentHash('b'));
    expect(contentHash('a')).toMatch(/^[a-f0-9]{64}$/);
  });
});
