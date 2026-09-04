import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadPluginInWorker } from './plugin-isolate.js';

describe('loadPluginInWorker', () => {
  it('registers a valid plugin in a worker thread', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'dockora-iso-'));
    try {
      const dir = path.join(root, 'hello');
      await mkdir(dir, { recursive: true });
      await writeFile(
        path.join(dir, 'index.js'),
        'export default { name: "hello", version: "1.2.3", register: async () => {}, unregister: async () => {} };\n',
      );
      const plugin = await loadPluginInWorker(path.join(dir, 'index.js'), root, 8_000);
      expect(plugin.name).toBe('hello');
      expect(plugin.version).toBe('1.2.3');
      await plugin.register();
      await plugin.unregister?.();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 20_000);

  it('terminates a hanging register()', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'dockora-hang-'));
    try {
      const dir = path.join(root, 'hang');
      await mkdir(dir, { recursive: true });
      await writeFile(
        path.join(dir, 'index.js'),
        'export default { name: "hang", version: "0", register: () => new Promise(() => {}) };\n',
      );
      await expect(loadPluginInWorker(path.join(dir, 'index.js'), root, 1_500)).rejects.toThrow(
        /timed out|exited/i,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 20_000);
});
