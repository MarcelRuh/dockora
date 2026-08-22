import { describe, expect, it } from 'vitest';
import {
  enrichPortConflictMessage,
  findContainerHoldingHostPort,
  isPortConflictMessage,
  parseAllocatedHostPort,
  portBindingUsesHostPort,
} from './port-conflict.js';

describe('port-conflict', () => {
  it('detects allocated / bind messages', () => {
    expect(
      isPortConflictMessage(
        'Bind for 0.0.0.0:3000 failed: port is already allocated',
      ),
    ).toBe(true);
    expect(isPortConflictMessage('something else')).toBe(false);
  });

  it('parses host port from daemon message', () => {
    expect(
      parseAllocatedHostPort(
        'Error response from daemon: Bind for 0.0.0.0:3000 failed: port is already allocated',
      ),
    ).toBe('3000');
    expect(
      parseAllocatedHostPort(
        'failed to set up container networking: Bind for [::]:80 failed: port is already allocated',
      ),
    ).toBe('80');
  });

  it('matches host side of port bindings', () => {
    expect(portBindingUsesHostPort('3000->80/tcp', '3000')).toBe(true);
    expect(portBindingUsesHostPort('127.0.0.1:3000->80/tcp', '3000')).toBe(true);
    expect(portBindingUsesHostPort('80/tcp', '80')).toBe(false);
    expect(portBindingUsesHostPort('3002->80/tcp', '3000')).toBe(false);
  });

  it('finds holder container and enriches message', () => {
    const containers = [
      { name: 'dockora-web', ports: ['3000->3000/tcp'] },
      { name: 'nginx-proxy-manager', ports: ['80->80/tcp', '443->443/tcp'] },
    ];
    expect(findContainerHoldingHostPort(containers, '3000')).toBe('dockora-web');
    const msg = enrichPortConflictMessage(
      'Bind for 0.0.0.0:3000 failed: port is already allocated',
      containers,
    );
    expect(msg).toContain('dockora-web');
    expect(msg).toContain('3000');
  });
});
