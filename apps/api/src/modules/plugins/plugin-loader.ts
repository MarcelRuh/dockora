import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { FastifyBaseLogger } from 'fastify';
import type { DockoraPlugin } from '../../domain/ports.js';
import type { PluginRegistry } from './index.js';

export interface DiscoveredPlugin {
  name: string;
  dirName: string;
  indexPath: string;
}

/**
 * Listet Plugin-Ordner unter PLUGIN_DIR (ohne zu laden).
 */
export async function discoverPlugins(pluginDir: string): Promise<DiscoveredPlugin[]> {
  let entries;
  try {
    entries = await readdir(pluginDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const found: DiscoveredPlugin[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const indexPath = path.join(pluginDir, entry.name, 'index.js');
    found.push({ name: entry.name, dirName: entry.name, indexPath });
  }
  return found;
}

export async function importPlugin(
  indexPath: string,
): Promise<DockoraPlugin | null> {
  const mod = (await import(pathToFileURL(indexPath).href)) as {
    default?: DockoraPlugin;
    plugin?: DockoraPlugin;
  };
  const plugin = mod.default ?? mod.plugin;
  if (!plugin || typeof plugin.register !== 'function' || !plugin.name) {
    return null;
  }
  return plugin;
}

/**
 * Lädt Plugins aus Unterordnern: PLUGIN_DIR/<name>/index.js
 * `disabled` = Plugin-Namen die übersprungen werden.
 */
export async function loadPluginsFromDir(
  registry: PluginRegistry,
  pluginDir: string,
  log: FastifyBaseLogger,
  disabled: Set<string> = new Set(),
): Promise<number> {
  const discovered = await discoverPlugins(pluginDir);
  if (discovered.length === 0) {
    log.debug({ pluginDir }, 'Plugin directory not found or empty – skipping loader');
    return 0;
  }

  let loaded = 0;
  for (const entry of discovered) {
    if (disabled.has(entry.dirName) || disabled.has(entry.name)) {
      log.info({ dir: entry.dirName }, 'Plugin disabled – skipping');
      continue;
    }
    try {
      const plugin = await importPlugin(entry.indexPath);
      if (!plugin) {
        log.warn({ dir: entry.dirName }, 'Skipping plugin – invalid DockoraPlugin export');
        continue;
      }
      await registry.register(plugin);
      loaded += 1;
      log.info({ name: plugin.name, version: plugin.version }, 'Plugin loaded');
    } catch (error) {
      log.warn(
        { dir: entry.dirName, err: error instanceof Error ? error.message : String(error) },
        'Failed to load plugin',
      );
    }
  }
  return loaded;
}
