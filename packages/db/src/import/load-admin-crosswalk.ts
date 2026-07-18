import { config as loadEnv } from 'dotenv';

// Runs from packages/db; load the monorepo-root .env for DATABASE_URL.
loadEnv({ path: ['.env', '../../.env'] });

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createDb, type PgPool } from '../client';

/**
 * D1 admin-crosswalk loader (docs/plan/DATA-INTEGRATION.md §D1).
 *
 * Runs AFTER infra/scripts/seed-geo.sh has loaded gis.admin_units (regions + the
 * 58 districts, with district name_ru = the geoBoundaries Latin `shapeName`). It:
 *   1. curates district name_ru/name_tg from data/d1-admin/district-names.csv;
 *   2. loads the dirty-token → canonical crosswalks (district/region/jamoat) built
 *      + adversarially verified from the historical КЧС registries into `stg`;
 *   3. resolves each alias to a concrete gis.admin_units id (+ region ISO), so the
 *      D3 incident ETL can geocode a free-text place straight to an admin unit.
 *
 * Everything is idempotent (re-runnable): the rename matches Latin→Russian only on
 * the first pass and no-ops afterwards; staging tables are truncated then reloaded.
 * Staging lives in schema `stg`, never in the Drizzle-managed app/gis schemas.
 */

const DATA_DIR = join(__dirname, '..', 'data', 'd1-admin');

/** Minimal RFC-4180 CSV parser (quoted fields, doubled quotes, CRLF-tolerant). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      // Skip the blank row a trailing newline would otherwise produce.
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    if (row.length > 1 || row[0] !== '') rows.push(row);
  }
  return rows;
}

/** Read a CSV into objects keyed by its header row. */
function readCsv(name: string): Record<string, string>[] {
  const rows = parseCsv(readFileSync(join(DATA_DIR, name), 'utf8'));
  const header = rows[0];
  if (!header) throw new Error(`${name}: empty file`);
  return rows.slice(1).map((r) => {
    const o: Record<string, string> = {};
    header.forEach((h, i) => (o[h] = r[i] ?? ''));
    return o;
  });
}

const pipes = (s: string | undefined): string[] => (s ? s.split('|').filter(Boolean) : []);

/** Insert rows in chunks via a single multi-row parameterized statement each. */
async function bulkInsert(
  pool: PgPool,
  table: string,
  columns: string[],
  rows: unknown[][],
  chunkSize = 200,
): Promise<void> {
  for (let start = 0; start < rows.length; start += chunkSize) {
    const chunk = rows.slice(start, start + chunkSize);
    const values: unknown[] = [];
    const tuples = chunk.map((r) => {
      const ph = r.map((_, j) => `$${values.length + j + 1}`);
      values.push(...r);
      return `(${ph.join(', ')})`;
    });
    await pool.query(
      `insert into ${table} (${columns.join(', ')}) values ${tuples.join(', ')}`,
      values,
    );
  }
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  const { pool } = createDb(url);

  try {
    // Guard: districts must be present (seed-geo.sh must have run first).
    const { rows: dcount } = await pool.query<{ n: string }>(
      `select count(*)::text as n from gis.admin_units where level = 'district'`,
    );
    if (Number(dcount[0]?.n ?? 0) === 0) {
      throw new Error(
        'gis.admin_units has no districts — run infra/scripts/seed-geo.sh before this loader.',
      );
    }

    // --- staging schema + tables ---
    await pool.query(`create schema if not exists stg`);
    await pool.query(`
      create table if not exists stg.district_names (
        latin   text primary key,
        name_ru text not null,
        name_tg text not null,
        aliases text[] not null default '{}'
      );
      create table if not exists stg.admin_alias (
        level           text not null,          -- region | district | jamoat (source column)
        raw_token       text not null,          -- verbatim value seen in the data
        kind            text not null,          -- district|city|region|zone|foreign|national|multi|unknown|jamoat
        canonical_latin text not null default '',-- district Latin (for district/city/jamoat parent)
        targets         text[] not null default '{}',
        note            text not null default '',
        admin_unit_id   uuid,                   -- resolved gis.admin_units id
        region_iso      text,                   -- resolved region ISO (TJ-*)
        primary key (level, raw_token)
      );
    `);
    await pool.query(`truncate stg.district_names`);
    await pool.query(`truncate stg.admin_alias`);

    // --- load district names ---
    const names = readCsv('district-names.csv');
    await bulkInsert(
      pool,
      'stg.district_names',
      ['latin', 'name_ru', 'name_tg', 'aliases'],
      names.map((n) => [n.latin, n.name_ru, n.name_tg, pipes(n.aliases)]),
    );

    // --- load the three alias sets into one staging table ---
    const distRows = readCsv('district-aliases.csv').map((r) => [
      'district',
      r.raw_token,
      r.kind,
      r.canonical_latin,
      pipes(r.targets),
      r.note,
    ]);
    const regionRows = readCsv('region-aliases.csv').map((r) => [
      'region',
      r.raw_token,
      r.kind,
      '',
      pipes(r.targets),
      r.note,
    ]);
    const jamoatRows = readCsv('jamoat-aliases.csv').map((r) => [
      'jamoat',
      r.raw_token,
      'jamoat',
      r.parent_latin,
      [] as string[],
      `confidence=${r.confidence}; ${r.note}`,
    ]);
    const cols = ['level', 'raw_token', 'kind', 'canonical_latin', 'targets', 'note'];
    await bulkInsert(pool, 'stg.admin_alias', cols, distRows);
    await bulkInsert(pool, 'stg.admin_alias', cols, regionRows);
    await bulkInsert(pool, 'stg.admin_alias', cols, jamoatRows);

    // --- (1) curate district RU/TG names (idempotent: Latin→Russian once) ---
    // seed-geo stores the geoBoundaries shapeName verbatim ("Ayni District"); the
    // crosswalk key drops the " District" suffix ("Ayni"). Strip it to match. On a
    // second run name_ru is already Russian, so the strip is a no-op and nothing
    // matches — the update stays idempotent.
    const renamed = await pool.query(`
      update gis.admin_units d
      set name_ru = n.name_ru, name_tg = n.name_tg, updated_at = now()
      from stg.district_names n
      where d.level = 'district' and btrim(replace(d.name_ru, ' District', '')) = n.latin
    `);

    // --- (2) resolve aliases → admin_unit + region ISO, most-specific first ---
    // Post-rename, admin_units.name_ru equals district_names.name_ru, so the
    // district pivot is stable on every subsequent run. Each pass only fills rows
    // still null, so a district match is never overwritten by a coarser region one.
    // Pass A — district by its own canonical (district / city-in-district / jamoat).
    const resA = await pool.query(`
      update stg.admin_alias a
      set admin_unit_id = d.id, region_iso = r.code
      from stg.district_names n
      join gis.admin_units d on d.level = 'district' and d.name_ru = n.name_ru
      left join gis.admin_units r on r.id = d.parent_id
      where a.admin_unit_id is null and a.canonical_latin <> '' and a.canonical_latin = n.latin
    `);
    // Pass B — district by the FIRST district-latin in targets (multi → primary
    // district; region-file rows tagged kind=district with a Latin target).
    const resB = await pool.query(`
      update stg.admin_alias a
      set admin_unit_id = d.id, region_iso = r.code
      from stg.district_names n
      join gis.admin_units d on d.level = 'district' and d.name_ru = n.name_ru
      left join gis.admin_units r on r.id = d.parent_id
      where a.admin_unit_id is null and cardinality(a.targets) > 0 and a.targets[1] = n.latin
    `);
    // Pass C — region by a region ISO in targets (city→its region, zone, region).
    const resC = await pool.query(`
      update stg.admin_alias a
      set admin_unit_id = r.id, region_iso = r.code
      from gis.admin_units r
      where a.admin_unit_id is null and r.level = 'region'
        and cardinality(a.targets) > 0 and r.code = a.targets[1]
    `);
    const resolvedDistrict = { rowCount: (resA.rowCount ?? 0) + (resB.rowCount ?? 0) };
    const resolvedRegion = { rowCount: resC.rowCount ?? 0 };

    // --- report ---
    const summary = await pool.query<{ level: string; kind: string; n: string; resolved: string }>(`
      select level, kind, count(*)::text as n,
             count(admin_unit_id)::text as resolved
      from stg.admin_alias group by level, kind order by level, kind
    `);
    const unresolvedCanon = await pool.query<{ raw_token: string; canonical_latin: string }>(`
      select raw_token, canonical_latin from stg.admin_alias
      where canonical_latin <> '' and admin_unit_id is null order by raw_token
    `);

    console.log(`D1 loader: district names curated (${renamed.rowCount} rows updated).`);
    console.log(
      `D1 loader: aliases resolved — ${resolvedDistrict.rowCount} district/city/jamoat, ` +
        `${resolvedRegion.rowCount} region/zone.`,
    );
    console.table(summary.rows);
    if (unresolvedCanon.rowCount && unresolvedCanon.rowCount > 0) {
      console.warn(
        `D1 loader: WARNING — ${unresolvedCanon.rowCount} aliases have a canonical that ` +
          `matched no district (check district-names.csv vs seed-geo output):`,
      );
      console.table(unresolvedCanon.rows.slice(0, 30));
    } else {
      console.log('D1 loader: every canonical alias resolved to a district. ✔');
    }
    console.log(
      'D1 loader: done. foreign/national/unknown aliases stay unresolved by design ' +
        '(see stg.admin_alias where admin_unit_id is null and kind in (…)).',
    );
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
