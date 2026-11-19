import { buildApp } from './app.js';
import { env } from './plugins/env.js';

const app = buildApp();

app
  .listen({ host: env.API_HOST, port: env.API_PORT })
  .then(() => {
    app.log.info(`API started on ${env.API_HOST}:${env.API_PORT}`);
  })
  .catch((error) => {
    app.log.error(error);
    process.exit(1);
  });
