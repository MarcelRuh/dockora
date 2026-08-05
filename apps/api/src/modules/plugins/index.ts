import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { API_PREFIX } from '@dockora/shared';
import type { DockoraPlugin } from '../../domain/ports.js';
import { loadPluginsFromDir } from './plugin-loader.js';

/**
 * Plugin-Registry – Erweiterungspunkt + Filesystem-Loader.
 */
export class PluginRegistry {
  private readonly plugins = new Map<string, DockoraPlugin>();

  async register(plugin: DockoraPlugin): Promise<void> {
    if (this.plugins.has(plugin.name)) {
      throw new Error(`Plugin already registered: ${plugin.name}`);
    }
    await plugin.register();
    this.plugins.set(plugin.name, plugin);
  }

  async unregister(name: string): Promise<void> {
    const plugin = this.plugins.get(name);
    if (!plugin) return;
    await plugin.unregister?.();
    this.plugins.delete(name);
  }

  list(): Array<{ name: string; version: string }> {
    return [...this.plugins.values()].map((p) => ({ name: p.name, version: p.version }));
  }
}

export const pluginsModule: FastifyPluginAsync = async (app: FastifyInstance) => {
  const registry = app.plugins ?? new PluginRegistry();
  if (!app.plugins) {
    app.decorate('plugins', registry);
  }

  const loaded = await loadPluginsFromDir(registry, app.config.pluginDir, app.log);
  if (loaded > 0) {
    app.log.info({ count: loaded, dir: app.config.pluginDir }, 'Plugins loaded from disk');
  }

  app.get(`${API_PREFIX}/plugins`, async () => ({
    plugins: registry.list(),
    pluginDir: app.config.pluginDir,
    note: 'Drop-in plugins: <pluginDir>/<name>/index.js exporting DockoraPlugin',
  }));
};

declare module 'fastify' {
  interface FastifyInstance {
    plugins: PluginRegistry;
  }
}
