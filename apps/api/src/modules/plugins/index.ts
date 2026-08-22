import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { API_PREFIX } from '@dockora/shared';
import type { DockoraPlugin } from '../../domain/ports.js';
import { actorIdFromRequest, auditService } from '../audit/audit.service.js';
import { prisma } from '../../infrastructure/db/prisma.js';
import {
  discoverPlugins,
  importPlugin,
  loadPluginsFromDir,
  registerPluginSandboxed,
} from './plugin-loader.js';

const DISABLED_KEY = 'plugins.disabled';

export interface PluginInfo {
  name: string;
  version: string | null;
  enabled: boolean;
  loaded: boolean;
  dirName: string;
}

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

  get(name: string): DockoraPlugin | undefined {
    return this.plugins.get(name);
  }

  list(): Array<{ name: string; version: string }> {
    return [...this.plugins.values()].map((p) => ({ name: p.name, version: p.version }));
  }

  has(name: string): boolean {
    return this.plugins.has(name);
  }
}

async function readDisabled(): Promise<Set<string>> {
  const row = await prisma.setting.findUnique({ where: { key: DISABLED_KEY } });
  if (!row?.value) return new Set();
  try {
    const parsed = JSON.parse(row.value) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((x): x is string => typeof x === 'string'));
  } catch {
    return new Set();
  }
}

async function writeDisabled(disabled: Set<string>): Promise<void> {
  const value = JSON.stringify([...disabled].sort());
  await prisma.setting.upsert({
    where: { key: DISABLED_KEY },
    create: { key: DISABLED_KEY, value },
    update: { value },
  });
}

export const pluginsModule: FastifyPluginAsync = async (app: FastifyInstance) => {
  const registry = app.plugins ?? new PluginRegistry();
  if (!app.plugins) {
    app.decorate('plugins', registry);
  }

  const disabled = await readDisabled();
  const loaded = await loadPluginsFromDir(registry, app.config.pluginDir, app.log, disabled);
  if (loaded > 0) {
    app.log.info({ count: loaded, dir: app.config.pluginDir }, 'Plugins loaded from disk');
  }

  async function listPlugins(): Promise<{ plugins: PluginInfo[]; pluginDir: string }> {
    const disabledNow = await readDisabled();
    const discovered = await discoverPlugins(app.config.pluginDir);
    const infos: PluginInfo[] = [];

    for (const d of discovered) {
      const live = registry.get(d.dirName) ?? findLoadedByDirHint(registry, d.dirName);
      infos.push({
        name: live?.name ?? d.dirName,
        version: live?.version ?? null,
        enabled: !disabledNow.has(d.dirName),
        loaded: Boolean(live),
        dirName: d.dirName,
      });
    }

    return {
      plugins: infos.sort((a, b) => a.name.localeCompare(b.name)),
      pluginDir: app.config.pluginDir,
    };
  }

  app.get(`${API_PREFIX}/plugins`, async () => listPlugins());

  app.post<{ Params: { name: string } }>(
    `${API_PREFIX}/plugins/:name/enable`,
    { preHandler: [app.requireRole('admin')] },
    async (request) => {
      const dirName = decodeURIComponent(request.params.name);
      const disabledNow = await readDisabled();
      disabledNow.delete(dirName);
      await writeDisabled(disabledNow);

      const already = registry.get(dirName) ?? findLoadedByDirHint(registry, dirName);
      if (!already) {
        const discovered = await discoverPlugins(app.config.pluginDir);
        const entry = discovered.find((d) => d.dirName === dirName);
        if (!entry) {
          throw app.httpErrors.notFound(`Plugin not found: ${dirName}`);
        }
        const plugin = await importPlugin(entry.indexPath, app.config.pluginDir);
        if (!plugin) {
          throw app.httpErrors.badRequest('Invalid plugin export');
        }
        if (!registry.has(plugin.name)) {
          await registerPluginSandboxed(registry, plugin);
        }
      }

      void auditService.record({
        action: 'plugins.enable',
        actorId: actorIdFromRequest(request),
        resource: 'plugin',
        resourceId: dirName,
      });

      return listPlugins();
    },
  );

  app.post<{ Params: { name: string } }>(
    `${API_PREFIX}/plugins/:name/disable`,
    { preHandler: [app.requireRole('admin')] },
    async (request) => {
      const dirName = decodeURIComponent(request.params.name);
      const disabledNow = await readDisabled();
      disabledNow.add(dirName);
      await writeDisabled(disabledNow);

      const live = registry.get(dirName) ?? findLoadedByDirHint(registry, dirName);
      if (live) {
        await registry.unregister(live.name);
      }

      void auditService.record({
        action: 'plugins.disable',
        actorId: actorIdFromRequest(request),
        resource: 'plugin',
        resourceId: dirName,
      });

      return listPlugins();
    },
  );
};

function findLoadedByDirHint(
  registry: PluginRegistry,
  dirName: string,
): DockoraPlugin | undefined {
  const direct = registry.get(dirName);
  if (direct) return direct;
  for (const p of registry.list()) {
    if (p.name === dirName) return registry.get(p.name);
  }
  return undefined;
}

declare module 'fastify' {
  interface FastifyInstance {
    plugins: PluginRegistry;
  }
}
