/**
 * Beispiel-Plugin für Dockora.
 * Ablage: plugins/hello/index.js (relativ zum Dockora-Root bzw. PLUGIN_DIR).
 *
 * @typedef {{ name: string, version: string, register: () => Promise<void>, unregister?: () => Promise<void> }} DockoraPlugin
 */

/** @type {DockoraPlugin} */
const plugin = {
  name: 'hello',
  version: '0.1.0',
  async register() {
    // bewusst no-op – demonstriert nur den Loader
    console.info('[dockora-plugin:hello] registered');
  },
  async unregister() {
    console.info('[dockora-plugin:hello] unregistered');
  },
};

export default plugin;
