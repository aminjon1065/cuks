import { config as loadEnv } from 'dotenv';

// Runs from packages/db; load the monorepo-root .env for DATABASE_URL.
loadEnv({ path: ['.env', '../../.env'] });

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createDb, type PgPool } from '../client';

/**
 * D3 incident ETL (docs/plan/DATA-INTEGRATION.md §D3). Loads the historical КЧС
 * registries (1988–2020, ~4.7k rows extracted by extract-incidents.py) into
 * app.incidents + app.incident_reports.
 *
 * Prerequisites (must run first):
 *   1. infra/scripts/seed-geo.sh  — regions + districts in gis.admin_units
 *   2. pnpm --filter @cuks/db load:crosswalk — stg.admin_alias (geo) resolved
 *   3. the incident_type dictionary (this loader seeds the 4 extra codes it needs).
 *
 * Pipeline: stage the two crosswalk CSVs → a single INSERT…SELECT that resolves
 * type (d2-types), geo (stg.admin_alias district→region), builds occurred_at from
 * year/month/day, derives severity, and geocodes to the admin-unit centroid
 * (ST_PointOnSurface); a matching incident_report snapshot per incident.
 *
 * Decisions (recorded in the plan): foreign locations (labour-migrant deaths
 * abroad) are skipped; national/unresolved rows land on the country centroid with
 * region=null; imported rows get `gen_random_uuid()` ids (v4 — pure-SQL bulk
 * insert; ids are opaque, only used for FK/lookup) and numbers `ЧС-{YYYY}-и{seq}`
 * to never collide with the app's live `ЧС-{YYYY}-{seq}`. Idempotent: the import
 * band is deleted (cascading its reports) and rebuilt on every run.
 */

const D2 = join(__dirname, '..', 'data', 'd2-types');
const D3 = join(__dirname, '..', 'data', 'd3-incidents');
/** Country centroid (ST_PointOnSurface of the union of regions) — fallback point
 *  for national/unresolved incidents that still need a non-null geometry. */
const TJ_CENTROID: readonly [number, number] = [70.9515, 38.859];

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
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    if (row.length > 1 || row[0] !== '') rows.push(row);
  }
  return rows;
}

/** Insert rows in chunks via a single multi-row parameterized statement each. */
async function bulkInsert(
  pool: PgPool,
  table: string,
  columns: string[],
  rows: unknown[][],
  chunkSize = 500,
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

const RAW_COLS = [
  'source_file',
  'source_sheet',
  'source_row',
  'year',
  'month',
  'day',
  'type_token',
  'prov_token',
  'dist_token',
  'jam_token',
  'dead',
  'injured',
  'rescued',
  'affected_text',
  'damage_sum',
  'damage_text',
  'description',
] as const;

/** The validated transform. `$1/$2` = country-centroid fallback lon/lat. */
const TRANSFORM_SQL = `
with base as (
  select ri.*, nullif(ri.year,'')::int as y,
    coalesce(nullif(ri.month,'')::int,7) as m0, coalesce(nullif(ri.day,'')::int,15) as d0,
    coalesce(nullif(tm.primary_code,'UNKNOWN'),'accident.other') as type_code,
    coalesce(da.admin_unit_id, ra.admin_unit_id) as unit_id,
    (coalesce(da.kind,'')='foreign' or coalesce(ra.kind,'')='foreign') as is_foreign
  from stg.raw_incidents ri
  left join stg.type_map tm on tm.raw_token = ri.type_token
  left join stg.admin_alias da on da.level='district' and da.raw_token = ri.dist_token
  left join stg.admin_alias ra on ra.level='region'   and ra.raw_token = ri.prov_token
  where nullif(ri.year,'') is not null
),
calc as (
  select b.*, least(b.m0,12) as m,
    least(b.d0, extract(day from (make_date(b.y, least(b.m0,12),1)+interval '1 month'-interval '1 day'))::int) as d,
    u.id as u_id, u.level as u_level, u.parent_id as u_parent, u.geom as u_geom
  from base b left join gis.admin_units u on u.id = b.unit_id
  where not (b.unit_id is null and b.is_foreign)
),
numbered as (
  select c.*, make_timestamptz(c.y,c.m,c.d,12,0,0,'Asia/Dushanbe') as occurred,
    row_number() over (partition by c.y order by c.m,c.d,c.source_row::int) as seq
  from calc c
)
insert into app.incidents
 (id,number,type_code,severity,status,occurred_at,reported_at,region_id,district_id,jamoat_id,geom,
  address_text,description,source,dead,injured,evacuated,affected,damage_est,damage_note,closed_at,created_by)
select gen_random_uuid(),
 'ЧС-'||n.y||'-и'||lpad(n.seq::text,4,'0'), n.type_code,
 case when coalesce(nullif(n.dead,'')::int,0)>=5 or coalesce(nullif(n.damage_sum,'')::numeric,0)>=1000000 then 4
      when coalesce(nullif(n.dead,'')::int,0)>=1 or coalesce(nullif(n.damage_sum,'')::numeric,0)>=100000 then 3
      else 2 end,
 'closed', n.occurred, n.occurred,
 case when n.u_level='region' then n.u_id when n.u_level='district' then n.u_parent end,
 case when n.u_level='district' then n.u_id end, null,
 case when n.u_geom is not null then st_pointonsurface(n.u_geom)
      else st_setsrid(st_makepoint($1,$2),4326) end,
 nullif(coalesce(n.dist_token,n.prov_token),''), nullif(n.description,''), 'report_doc',
 coalesce(nullif(n.dead,'')::int,0), coalesce(nullif(n.injured,'')::int,0), 0, 0,
 nullif(n.damage_sum,'')::numeric, nullif(n.damage_text,''), n.occurred, null
from numbered n
`;

const NEW_DICT_CODES: ReadonlyArray<[string, string | null, string, number]> = [
  ['accident', null, 'Происшествие', 4],
  ['accident.drowning', 'accident', 'Утопление', 1],
  ['accident.electrocution', 'accident', 'Поражение электротоком', 2],
  ['accident.other', 'accident', 'Прочее происшествие', 3],
  ['nat.meteo.lightning', 'nat.meteo', 'Гроза, удар молнии', 9],
];

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  const { pool } = createDb(url);
  try {
    // Prerequisite guard: geo crosswalk must be resolved (D1).
    const { rows: pre } = await pool.query<{ n: string }>(
      `select count(*)::text n from stg.admin_alias where admin_unit_id is not null`,
    );
    if (Number(pre[0]?.n ?? 0) === 0) {
      throw new Error('stg.admin_alias is empty/unresolved — run load:crosswalk (D1) first.');
    }

    // Extra incident_type codes this dataset needs (all-hazards: drowning etc.).
    for (const [code, parent, nameRu, sort] of NEW_DICT_CODES) {
      await pool.query(
        `insert into app.dictionaries (id,type,code,parent_code,name_ru,name_tg,sort)
         values (gen_random_uuid(),'incident_type',$1,$2,$3,$3,$4)
         on conflict (type,code) do nothing`,
        [code, parent, nameRu, sort],
      );
    }

    // Stage the two crosswalk inputs.
    await pool.query(`create schema if not exists stg`);
    await pool.query(`drop table if exists stg.raw_incidents`);
    await pool.query(
      `create table stg.raw_incidents (${RAW_COLS.map((c) => `${c} text`).join(', ')})`,
    );
    await pool.query(`drop table if exists stg.type_map`);
    await pool.query(
      `create table stg.type_map (raw_token text primary key, primary_code text,
        secondary_codes text, verified text, freq text, note text)`,
    );

    const raw = parseCsv(readFileSync(join(D3, 'stg-incidents.csv'), 'utf8')).slice(1);
    await bulkInsert(pool, 'stg.raw_incidents', [...RAW_COLS], raw);
    const tmap = parseCsv(readFileSync(join(D2, 'type-map.csv'), 'utf8')).slice(1);
    await bulkInsert(
      pool,
      'stg.type_map',
      ['raw_token', 'primary_code', 'secondary_codes', 'verified', 'freq', 'note'],
      tmap,
    );

    // Idempotency: drop the previous import band (cascades to its reports).
    const del = await pool.query(
      `delete from app.incidents where source='report_doc' and number like 'ЧС-%-и%'`,
    );

    const ins = await pool.query(TRANSFORM_SQL, [TJ_CENTROID[0], TJ_CENTROID[1]]);

    // One report snapshot per imported incident.
    const rep = await pool.query(`
      insert into app.incident_reports
        (id,incident_id,reported_at,text,dead,injured,evacuated,affected,damage_est,damage_note,author_id)
      select gen_random_uuid(), i.id, i.occurred_at, i.description, i.dead, i.injured,
             i.evacuated, i.affected, i.damage_est, i.damage_note, null
      from app.incidents i
      where i.source='report_doc' and i.number like 'ЧС-%-и%'
    `);

    // Report + sanity.
    const { rows: chk } = await pool.query<{
      total: string;
      geo_admin: string;
      geo_fallback: string;
      valid_geom: string;
    }>(`
      select count(*)::text total,
        count(*) filter (where region_id is not null)::text geo_admin,
        count(*) filter (where region_id is null)::text geo_fallback,
        count(*) filter (where st_isvalid(geom) and st_x(geom) between 67 and 75.5
                          and st_y(geom) between 36.5 and 41.2)::text valid_geom
      from app.incidents where source='report_doc' and number like 'ЧС-%-и%'`);
    const c = chk[0];
    console.log(
      `D3 loader: staged ${raw.length} rows; deleted ${del.rowCount} prior; ` +
        `inserted ${ins.rowCount} incidents + ${rep.rowCount} reports ` +
        `(foreign/no-year skipped = ${raw.length - (ins.rowCount ?? 0)}).`,
    );
    console.log(
      `D3 loader: geo — ${c?.geo_admin} to admin unit, ${c?.geo_fallback} to country centroid; ` +
        `valid geometry in TJ bbox: ${c?.valid_geom}/${c?.total}. ✔`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
