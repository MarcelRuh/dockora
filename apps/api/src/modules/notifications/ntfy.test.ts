import { describe, expect, it } from 'vitest';
import { ntfyEndpoint, ntfyPriority } from './ntfy.js';

describe('ntfy', () => {
  it('builds a topic URL and rejects a bad topic', () => {
    expect(ntfyEndpoint('https://ntfy.sh/', 'dockora')).toBe('https://ntfy.sh/dockora');
    expect(() => ntfyEndpoint('https://ntfy.sh', '../etc')).toThrow(/topic/);
    expect(() => ntfyEndpoint('ftp://files', 'dockora')).toThrow(/http/);
  });

  it('raises priority for warnings and errors', () => {
    expect(ntfyPriority('error')).toBe('5');
    expect(ntfyPriority('warning')).toBe('4');
    expect(ntfyPriority('info')).toBe('3');
  });
});