import 'dotenv/config';
import { loadConfig } from './config/env.js';
import { createLogger } from './infrastructure/logging/logger.js';
import { buildApp } from './app.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);

  const app = await buildApp({ config, logger });

  try {
    await app.listen({ host: config.host, port: config.port });
    logger.info(
      { host: config.host, port: config.port },
      `Dockora API listening on http://${config.host}:${config.port}`,
    );
  } catch (error) {
    logger.error({ err: error }, 'Failed to start Dockora API');
    process.exit(1);
  }

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down…');
    await app.close();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

void main();
