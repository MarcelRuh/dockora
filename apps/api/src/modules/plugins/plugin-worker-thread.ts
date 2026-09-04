import { parentPort, workerData } from 'node:worker_threads';
import { importPlugin } from './plugin-loader.js';

const port = parentPort;
if (!port) {
  throw new Error('plugin-worker-thread must run as a worker');
}

const { indexPath, pluginDir } = workerData as { indexPath: string; pluginDir: string };

const plugin = await importPlugin(indexPath, pluginDir);
if (!plugin) {
  port.postMessage({ type: 'error', message: 'invalid plugin export' });
} else {
  try {
    await plugin.register();
    port.postMessage({ type: 'ready', name: plugin.name, version: plugin.version });
  } catch (error) {
    port.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

port.on('message', async (msg: { type?: string }) => {
  if (msg?.type !== 'unregister') return;
  try {
    await plugin?.unregister?.();
    port.postMessage({ type: 'unregistered' });
  } catch (error) {
    port.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
    });
  }
});
