import pino, { type Logger } from 'pino';
import type { FastifyBaseLogger } from 'fastify';
import type { AppConfig } from '../../config/env.js';

export function createLogger(level: AppConfig['logLevel']): Logger & FastifyBaseLogger {
  return pino({
    level,
    name: 'dockora-api',
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level(label) {
        return { level: label };
      },
    },
  }) as Logger & FastifyBaseLogger;
}
