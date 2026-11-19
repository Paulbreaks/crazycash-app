import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaClient } from '@prisma/client';

function createPrismaAdapter() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required to create Prisma Client');
  }

  const url = new URL(databaseUrl);
  const database = url.pathname.slice(1);

  if (!database) {
    throw new Error('DATABASE_URL must include a database name');
  }

  return new PrismaMariaDb({
    host: url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database,
    connectionLimit: 10,
  });
}

// Prisma ORM 7 requires a database driver adapter for direct MySQL connections.
export const prisma = new PrismaClient({ adapter: createPrismaAdapter() });
