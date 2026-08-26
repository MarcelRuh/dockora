import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { APP_NAME, APP_VERSION } from '@dockora/shared';

export const openApiModule: FastifyPluginAsync = async (app: FastifyInstance) => {
  await app.register(swagger, {
    openapi: {
      info: {
        title: `${APP_NAME} API`,
        description:
          'REST API für Docker-Compose-Management, Updates, Backups und Monitoring.',
        version: APP_VERSION,
      },
      servers: [{ url: '/' }],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
          },
          cookieAuth: {
            type: 'apiKey',
            in: 'cookie',
            name: 'dockora_session',
          },
        },
      },
    },
  });

  await app.register(swaggerUi, {
    routePrefix: '/api/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true,
    },
  });
};
