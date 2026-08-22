import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PLUGIN_NAME_RE,
  assertSafePluginPath,
  discoverPlugins,
  withTimeout,
} from './plugin-loader.js';

describe('plugin sandbox helpers', () => {
  it('rejects unsafe plugin names', () => {
    expect(PLUGIN_NAME_RE.test('hello')).toBe(true);
    expect(PLUGIN_NAME_RE.test('../evil')).toBe(false);
    expect(PLUGIN_NAME_RE.test('has space')).toBe(false);
  });

  it('assertSafePluginPath blocks path escape', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'dockora-plug-'));
    try {
      const plugDir = path.join(root, 'plugins');
      await mkdir(path.join(plugDir, 'hello'), { recursive: true });
      const indexPath = path.join(plugDir, 'hello', 'index.js');
      await writeFile(indexPath, 'export default { name: "hello", version: "0", register: async () => {} }');

      const safe = await assertSafePluginPath(plugDir, indexPath);
      expect(safe).toContain(`${path.sep}hello${path.sep}index.js`);

      await expect(
        assertSafePluginPath(plugDir, path.join(root, 'outside.js')),
      ).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('discoverPlugins skips invalid directory names', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'dockora-disc-'));
    try {
      await mkdir(path.join(root, 'hello'), { recursive: true });
      await mkdir(path.join(root, 'bad name'), { recursive: true });
      const found = await discoverPlugins(root);
      expect(found.map((f) => f.dirName)).toEqual(['hello']);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('withTimeout rejects slow promises', async () => {
    await expect(
      withTimeout(new Promise((r) => setTimeout(r, 200)), 20, 'slow'),
    ).rejects.toThrow('slow');
  });
});
