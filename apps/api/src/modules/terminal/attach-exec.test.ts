import { describe, expect, it } from 'vitest';
import { interactiveShellCommand, resolveShell } from './attach-exec.js';

describe('interactiveShellCommand', () => {
  it('auto-detects bash/zsh via a POSIX bootstrap', () => {
    const cmd = interactiveShellCommand();
    expect(cmd?.[0]).toBe('/bin/sh');
    expect(cmd?.[1]).toBe('-c');
    expect(cmd?.[2]).toContain('exec bash -i');
    expect(cmd?.[2]).toContain('exec zsh -i');
    expect(cmd?.[2]).toContain('exec /bin/sh -i');
    expect(cmd?.[2]).toContain('TERM=');
  });

  it('runs an allowlisted shell interactively', () => {
    expect(interactiveShellCommand('bash')).toEqual(['/bin/bash', '-i']);
    expect(interactiveShellCommand('/bin/sh')).toEqual(['/bin/sh', '-i']);
  });

  it('rejects unknown shells', () => {
    expect(interactiveShellCommand('/bin/fish')).toBeNull();
    expect(resolveShell('cmd.exe')).toBeNull();
  });
});
