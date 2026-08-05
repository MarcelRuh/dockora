import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { FastifyBaseLogger } from 'fastify';
import type { DockoraPlugin } from '../../domain/ports.js';
import type { PluginRegistry } from './index.js';

/**
 * Lädt Plugins aus Unterordnern: PLUGIN_DIR/<name>/index.js
 * Default-Export oder `plugin` muss DockoraPlugin erfüllen.
 */
export async function loadPluginsFromDir(
  registry: PluginRegistry,
  pluginDir: string,
  log: FastifyBaseLogger,
): Promise<number> {
  let entries;
  try {
    entries = await readdir(pluginDir, { withFileTypes: true });
  } catch {
    log.debug({ pluginDir }, 'Plugin directory not found – skipping loader');
    return 0;
  }

  let loaded = 0;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const indexJs = path.join(pluginDir, entry.name, 'index.js');
    try {
      const mod = (await import(pathToFileURL(indexJs).href)) as {
        default?: DockoraPlugin;
        plugin?: DockoraPlugin;
      };
      const plugin = mod.default ?? mod.plugin;
      if (!plugin || typeof plugin.register !== 'function' || !plugin.name) {
        log.warn({ dir: entry.name }, 'Skipping plugin – invalid DockoraPlugin export');
        continue;
      }
      await registry.register(plugin);
      loaded += 1;
      log.info({ name: plugin.name, version: plugin.version }, 'Plugin loaded');
    } catch (error) {
      log.warn(
        { dir: entry.name, err: error instanceof Error ? error.message : String(error) },
        'Failed to load plugin',
      );
    }
  }
  return loaded;
}
