import { Worker } from 'node:worker_threads';
import type { DockoraPlugin } from '../../domain/ports.js';

const DEFAULT_REGISTER_TIMEOUT_MS = 5_000;

type WorkerOk = { type: 'ready'; name: string; version: string };
type WorkerFail = { type: 'error'; message: string };
type WorkerUnreg = { type: 'unregistered' };
type WorkerMsg = WorkerOk | WorkerFail | WorkerUnreg;

function workerUrl(): URL {
  const ext = import.meta.url.endsWith('.ts') ? '.ts' : '.js';
  return new URL(`./plugin-worker-thread${ext}`, import.meta.url);
}

function waitFor(
  worker: Worker,
  timeoutMs: number,
  label: string,
): Promise<WorkerMsg> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      void worker.terminate();
      reject(new Error(`Plugin ${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    const onMessage = (msg: WorkerMsg) => {
      cleanup();
      resolve(msg);
    };
    const onError = (err: Error) => {
      cleanup();
      reject(err);
    };
    const onExit = (code: number) => {
      cleanup();
      reject(new Error(`Plugin worker exited (${code}) during ${label}`));
    };

    const cleanup = () => {
      clearTimeout(timer);
      worker.off('message', onMessage);
      worker.off('error', onError);
      worker.off('exit', onExit);
    };

    worker.on('message', onMessage);
    worker.on('error', onError);
    worker.on('exit', onExit);
  });
}

/**
 * Import + register() in a worker thread so a hanging plugin cannot block the API event loop.
 * The returned contract's register() is a no-op (already ran in the worker).
 */
export async function loadPluginInWorker(
  indexPath: string,
  pluginDir: string,
  timeoutMs = DEFAULT_REGISTER_TIMEOUT_MS,
): Promise<DockoraPlugin> {
  const worker = new Worker(workerUrl(), {
    workerData: { indexPath, pluginDir },
    execArgv: import.meta.url.endsWith('.ts') ? ['--import', 'tsx'] : [],
  });

  const msg = await waitFor(worker, timeoutMs, 'register');
  if (msg.type !== 'ready') {
    await worker.terminate();
    throw new Error(msg.type === 'error' ? msg.message : 'Plugin worker failed');
  }

  return Object.freeze({
    name: msg.name,
    version: msg.version,
    register: async () => undefined,
    unregister: async () => {
      worker.postMessage({ type: 'unregister' });
      try {
        const done = await waitFor(worker, timeoutMs, 'unregister');
        if (done.type === 'error') {
          throw new Error(done.message);
        }
      } finally {
        await worker.terminate();
      }
    },
  });
}
