import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import { Pool, type PoolConfig } from 'pg';
import * as schema from './schema/index';

export type Database = NodePgDatabase<typeof schema>;

export interface DbHandle {
  db: Database;
  pool: Pool;
}

/**
 * Create a connection pool + drizzle instance from a connection string.
 *
 * `onError` handles asynchronous pool errors. node-postgres re-emits backend
 * failures on idle pooled clients (Postgres restart, `pg_terminate_backend`,
 * TCP reap) as an `'error'` event; without a listener Node turns it into an
 * uncaught exception that crashes the process. Always attach one.
 */
export function createDb(
  connectionString: string,
  config: PoolConfig = {},
  onError: (err: Error) => void = (err) => console.error('[db] unexpected pool error', err),
): DbHandle {
  const pool = new Pool({ connectionString, ...config });
  pool.on('error', onError);
  const db = drizzle(pool, { schema });
  return { db, pool };
}

/** Liveness probe for the DB (used by `GET /api/health/ready`). */
export async function checkDatabase(db: Database): Promise<boolean> {
  await db.execute(sql`select 1`);
  return true;
}
