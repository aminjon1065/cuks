import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import { Pool, type PoolConfig } from 'pg';
import * as schema from './schema/index';

export type Database = NodePgDatabase<typeof schema>;

export interface DbHandle {
  db: Database;
  pool: Pool;
}

/** Create a connection pool + drizzle instance from a connection string. */
export function createDb(connectionString: string, config: PoolConfig = {}): DbHandle {
  const pool = new Pool({ connectionString, ...config });
  const db = drizzle(pool, { schema });
  return { db, pool };
}

/** Liveness probe for the DB (used by `GET /api/health/ready`). */
export async function checkDatabase(db: Database): Promise<boolean> {
  await db.execute(sql`select 1`);
  return true;
}
