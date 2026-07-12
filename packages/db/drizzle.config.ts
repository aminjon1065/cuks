import { config } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

// drizzle-kit runs from packages/db; load the monorepo-root .env for DATABASE_URL.
config({ path: ['.env', '../../.env'] });

export default defineConfig({
  schema: './src/schema/*',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://cuks:cuks@localhost:5432/cuks',
  },
  verbose: true,
  strict: true,
});
