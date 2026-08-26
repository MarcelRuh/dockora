import { access, realpath, readdir } from 'node:fs/promises';
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

export const PLUGIN_NAME_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
export const DEFAULT_REGISTER_TIMEOUT_MS = 5_000;

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
    if (!PLUGIN_NAME_RE.test(entry.name)) continue;
    const indexPath = path.join(pluginDir, entry.name, 'index.js');
    found.push({ name: entry.name, dirName: entry.name, indexPath });
  }
  return found;
}

/**
 * Ensures the plugin file resolves under PLUGIN_DIR (no path traversal).
 */
export async function assertSafePluginPath(
  pluginDir: string,
  indexPath: string,
): Promise<string> {
  const root = await realpath(pluginDir);
  let resolved: string;
  try {
    resolved = await realpath(indexPath);
  } catch {
    throw new Error(`Plugin index not found: ${indexPath}`);
  }
  const rel = path.relative(root, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('Plugin path escapes PLUGIN_DIR');
  }
  if (path.basename(resolved) !== 'index.js') {
    throw new Error('Plugin entry must be index.js');
  }
  return resolved;
}

export async function importPlugin(
  indexPath: string,
  pluginDir?: string,
): Promise<DockoraPlugin | null> {
  const safePath = pluginDir
    ? await assertSafePluginPath(pluginDir, indexPath)
    : indexPath;

  await access(safePath);

  const mod = (await import(pathToFileURL(safePath).href)) as {
    default?: DockoraPlugin;
    plugin?: DockoraPlugin;
  };
  const plugin = mod.default ?? mod.plugin;
  if (!plugin || typeof plugin.register !== 'function' || !plugin.name) {
    return null;
  }
  if (!PLUGIN_NAME_RE.test(plugin.name)) {
    return null;
  }
  return sealPlugin(plugin);
}

/** Copy only the plugin contract so loaded modules cannot mutate the registry later. */
export function sealPlugin(plugin: DockoraPlugin): DockoraPlugin {
  const register = plugin.register.bind(plugin);
  const unregister = plugin.unregister?.bind(plugin);
  return Object.freeze({
    name: String(plugin.name),
    version: String(plugin.version ?? '0'),
    register: () => register(),
    unregister: unregister ? () => unregister() : undefined,
  });
}

export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message: string,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * register() mit Timeout – hängt ein Plugin nicht den API-Start.
 * Zusätzlich: Pfad-Canonicalisierung + Namens-Allowlist beim Import.
 */
export async function registerPluginSandboxed(
  registry: PluginRegistry,
  plugin: DockoraPlugin,
  timeoutMs = DEFAULT_REGISTER_TIMEOUT_MS,
): Promise<void> {
  await withTimeout(
    registry.register(plugin),
    timeoutMs,
    `Plugin "${plugin.name}" register timed out after ${timeoutMs}ms`,
  );
}

export async function unregisterPluginSandboxed(
  registry: PluginRegistry,
  name: string,
  timeoutMs = DEFAULT_REGISTER_TIMEOUT_MS,
): Promise<void> {
  await withTimeout(
    registry.unregister(name),
    timeoutMs,
    `Plugin "${name}" unregister timed out after ${timeoutMs}ms`,
  );
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
      const plugin = await withTimeout(
        importPlugin(entry.indexPath, pluginDir),
        DEFAULT_REGISTER_TIMEOUT_MS,
        `Plugin "${entry.dirName}" import timed out after ${DEFAULT_REGISTER_TIMEOUT_MS}ms`,
      );
      if (!plugin) {
        log.warn({ dir: entry.dirName }, 'Skipping plugin – invalid DockoraPlugin export');
        continue;
      }
      await registerPluginSandboxed(registry, plugin);
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
