import { describe, expect, it } from 'vitest';
import { ntfyEndpoint, ntfyPriority } from './ntfy.js';

describe('ntfy', () => {
  it('builds a topic URL and rejects a bad topic', () => {
    expect(ntfyEndpoint('https://ntfy.sh/', 'dockora')).toBe('https://ntfy.sh/dockora');
    expect(() => ntfyEndpoint('https://ntfy.sh', '../etc')).toThrow(/topic/);
    expect(() => ntfyEndpoint('ftp://files', 'dockora')).toThrow(/http/);
    expect(ntfyEndpoint('http://192.168.178.20:2586', 'dockora')).toBe(
      'http://192.168.178.20:2586/dockora',
    );
    expect(() => ntfyEndpoint('http://127.0.0.1', 'dockora')).toThrow(/not allowed/);
    expect(() => ntfyEndpoint('http://169.254.169.254', 'dockora')).toThrow(/not allowed/);
    expect(() => ntfyEndpoint('http://localhost', 'dockora')).toThrow(/not allowed/);
    expect(() => ntfyEndpoint('http://user:pass@ntfy.sh', 'dockora')).toThrow(/credentials/);
  });

  it('raises priority for warnings and errors', () => {
    expect(ntfyPriority('error')).toBe('5');
    expect(ntfyPriority('warning')).toBe('4');
    expect(ntfyPriority('info')).toBe('3');
  });
});