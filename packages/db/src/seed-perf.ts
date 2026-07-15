import { config as loadEnv } from 'dotenv';

// Runs from packages/db; load the monorepo-root .env for DATABASE_URL.
loadEnv({ path: ['.env', '../../.env'] });

import { sql } from 'drizzle-orm';
import { createDb, type Database } from './client';

/**
 * Load generator for the map-performance acceptance (docs/modules/10 §11: «Карта с
 * 10k ЧС … держит 60fps»). Scatters N incidents (default 10 000) uniformly inside
 * the seeded region polygons with ST_GeneratePoints, so the clustering tile function
 * and the map are exercised against a realistic country-wide distribution.
 *
 * Idempotent: every run first removes the prior `ЧС-PERF-%` batch, so it can be
 * dialled up/down freely. All rows carry the `ЧС-PERF-` number prefix, so
 * `pnpm db:seed:perf -- --clean` (or the SQL below) removes them without touching
 * real or e2e data.
 */
const PERF_PREFIX = 'ЧС-PERF-';
const DEFAULT_COUNT = 10_000;
// Two dictionary codes known to exist in the seed (matches the e2e map fixtures).
const TYPE_CODES = ['nat.hydro.flood', 'tech.fire_explosion'];
// The open lifecycle states only: a 'closed' row would need closed_at set
// (incidents_closed_at_chk), and closed incidents are irrelevant to map load.
const STATUSES = ['active', 'reported', 'localized', 'eliminated'];

async function clean(db: Database): Promise<number> {
  const res = await db.execute<{ n: number }>(sql`
    with deleted as (
      delete from app.incidents where number like ${PERF_PREFIX + '%'} returning 1
    )
    select count(*)::int as n from deleted
  `);
  return Number(res.rows[0]?.n ?? 0);
}

async function seed(db: Database, count: number): Promise<void> {
  const [actor] = (
    await db.execute<{ id: string }>(sql`
      select id from app.users where username = 'admin' limit 1
    `)
  ).rows;
  if (!actor) throw new Error('Perf seed requires the base seed (no "admin" user found)');

  const regionCount = (
    await db.execute<{ n: number }>(sql`
      select count(*)::int as n from gis.admin_units where parent_id is null
    `)
  ).rows[0]?.n;
  if (!regionCount) throw new Error('Perf seed requires seeded regions (run seed-geo first)');
  const perRegion = Math.ceil(count / regionCount);

  const typeArray = sql.raw(`array[${TYPE_CODES.map((c) => `'${c}'`).join(',')}]`);
  const statusArray = sql.raw(`array[${STATUSES.map((s) => `'${s}'`).join(',')}]`);

  // ST_GeneratePoints yields points inside each region polygon; row_number gives a
  // stable per-row seed for the deterministic type/status/time spread. reported_at is
  // held 30 min after occurred_at to satisfy the chronology check.
  await db.execute(sql`
    with raw_pts as (
      -- st_dump expands each region into perRegion points; number AFTER the expansion
      -- (a row_number over the region rows would repeat once per region).
      select r.id as region_id,
             (st_dump(st_generatepoints(r.geom, ${perRegion}))).geom as geom
      from gis.admin_units r
      where r.parent_id is null
    ),
    pts as (
      select region_id, geom, row_number() over () as rn from raw_pts limit ${count}
    )
    insert into app.incidents
      (id, number, type_code, severity, status, occurred_at, reported_at, region_id, geom,
       source, created_by)
    select
      gen_random_uuid(),
      ${PERF_PREFIX} || lpad(rn::text, 6, '0'),
      (${typeArray})[1 + (rn % 2)],
      1 + (rn % 5),
      (${statusArray})[1 + (rn % 4)],
      now() - ((rn % 365) || ' days')::interval,
      now() - ((rn % 365) || ' days')::interval + interval '30 minutes',
      region_id,
      st_setsrid(geom, 4326),
      'monitoring',
      ${actor.id}
    from pts
  `);

  const total = (
    await db.execute<{ n: number }>(sql`
      select count(*)::int as n from app.incidents where number like ${PERF_PREFIX + '%'}
    `)
  ).rows[0]?.n;
  console.log(`perf seed: ${total} "${PERF_PREFIX}" incidents across ${regionCount} regions.`);
}

/**
 * Representative tiles covering Tajikistan: a whole-country z6 tile (where 10k
 * points must collapse into a handful of clusters), a regional z9 and a city-detail
 * z11. `query_params` is empty so every incident is in scope — the worst case.
 */
const BENCH_TILES: Array<{ label: string; z: number; x: number; y: number }> = [
  { label: 'z6 country (clustered)', z: 6, x: 44, y: 24 },
  { label: 'z9 regional', z: 9, x: 355, y: 196 },
  { label: 'z11 city detail', z: 11, x: 1421, y: 785 },
];
// An MVT tile the renderer handles smoothly stays well under 64 KiB. A country tile
// near that ceiling would mean clustering failed and 10k raw points were emitted.
const TILE_BYTES_BUDGET = 64 * 1024;

async function benchmark(db: Database): Promise<void> {
  const total = (
    await db.execute<{ n: number }>(sql`
      select count(*)::int as n from app.incidents where deleted_at is null
    `)
  ).rows[0]?.n;
  console.log(`perf bench: ${total} live incidents in scope.`);

  let failed = false;
  for (const tile of BENCH_TILES) {
    // Warm the plan cache, then measure server-side generation time.
    await db.execute(sql`select gis.incidents_mvt(${tile.z}, ${tile.x}, ${tile.y}, '{}'::json)`);
    const row = (
      await db.execute<{ bytes: number; ms: number }>(sql`
        with m as (
          select clock_timestamp() as t0,
                 length(gis.incidents_mvt(${tile.z}, ${tile.x}, ${tile.y}, '{}'::json)) as bytes,
                 clock_timestamp() as t1
        )
        select bytes, round(extract(milliseconds from (t1 - t0))::numeric, 1)::float8 as ms from m
      `)
    ).rows[0];
    const bytes = Number(row?.bytes ?? 0);
    const ms = Number(row?.ms ?? 0);
    const over = bytes > TILE_BYTES_BUDGET;
    if (over) failed = true;
    console.log(
      `  ${tile.label.padEnd(24)} ${String(bytes).padStart(7)} bytes  ${String(ms).padStart(6)} ms` +
        (over ? '  ⚠ over budget' : ''),
    );
  }
  if (failed) {
    throw new Error(`A tile exceeded the ${TILE_BYTES_BUDGET}-byte budget — clustering regressed.`);
  }
  console.log('perf bench: OK — every tile within budget.');
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('seed-perf must not run with NODE_ENV=production (load fixture only)');
  }
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required for the perf seed');

  const cleanOnly = process.argv.includes('--clean');
  const bench = process.argv.includes('--bench');
  const countArg = process.argv.find((a) => /^--count=\d+$/.test(a));
  const count = countArg ? Number(countArg.split('=')[1]) : DEFAULT_COUNT;

  const { db, pool } = createDb(url);
  try {
    if (cleanOnly) {
      const removed = await clean(db);
      console.log(`perf seed: removed ${removed} "${PERF_PREFIX}" incidents.`);
      return;
    }
    await clean(db);
    await seed(db, count);
    if (bench) await benchmark(db);
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
