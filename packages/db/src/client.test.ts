import { describe, expect, it } from 'vitest';
import { createDb } from './client';

describe('createDb', () => {
  it('builds a pool + drizzle handle without connecting eagerly', () => {
    const { db, pool } = createDb('postgres://cuks:cuks@localhost:5432/cuks');
    expect(db).toBeDefined();
    expect(pool).toBeDefined();
    // Pool is lazy; no connection is opened until the first query.
    void pool.end();
  });
});
