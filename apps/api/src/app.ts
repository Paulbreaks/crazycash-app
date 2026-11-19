import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { env } from './plugins/env.js';
import { healthRoutes } from './modules/health/routes.js';
import { authRoutes } from './modules/auth/routes.js';
import { meRoutes } from './modules/me/routes.js';
import { slot777Routes } from './modules/slot777/routes.js';
import { tonRoutes } from './modules/ton/routes.js';

export function buildApp() {
  const app = Fastify({
    // API is published only on the host loopback interface. Host Nginx is its
    // sole public ingress and overwrites X-Forwarded-For with $remote_addr;
    // therefore Fastify can safely use the original client IP for rate limits
    // and guest analytics. Do not expose API_PORT publicly without replacing
    // this with a restricted proxy-address policy.
    trustProxy: true,
    logger:
      env.NODE_ENV === 'development'
        ? {
            transport: {
              target: 'pino-pretty',
              options: {
                colorize: true,
                translateTime: 'SYS:standard',
                ignore: 'pid,hostname',
              },
            },
          }
        : true,
  });

  // Искусственная задержка помогает проверить загрузочные состояния Godot и
  // Shell. Она принципиально не работает в production, даже если переменная
  // окружения там оказалась задана.
  if (env.NODE_ENV === 'development' && env.DEV_API_RESPONSE_DELAY_MS > 0) {
    app.addHook('onRequest', async () => {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, env.DEV_API_RESPONSE_DELAY_MS);
      });
    });
  }

  // Session cookies must be parsed before any authenticated route reads them.
  void app.register(cookie);

  void app.register(cors, {
    origin: env.API_ORIGIN,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });
  void app.register(helmet);
  void app.register(rateLimit, {
    max: 120,
    timeWindow: '1 minute',
  });

  void healthRoutes(app);
  void authRoutes(app);
  void meRoutes(app);
  void tonRoutes(app);
  void slot777Routes(app);

  return app;
}
