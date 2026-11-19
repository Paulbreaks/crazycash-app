import { defineConfig, env } from 'prisma/config';

/**
 * Connection settings for Prisma ORM 7. The database URL stays in environment
 * variables and is intentionally not stored in schema.prisma or the repository.
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
});
