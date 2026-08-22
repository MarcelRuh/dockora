/** Shared Fastify route config for destructive actions. */
export const destructiveRateLimit = {
  config: {
    rateLimit: {
      max: 10,
      timeWindow: '1 minute',
    },
  },
} as const;
