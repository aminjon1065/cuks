import { config as loadEnv } from 'dotenv';

loadEnv({ path: ['.env', '../../.env'] });

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createDb, type PgPool } from '../client';

/**
 * D6 casualty enrichment (docs/plan/DATA-INTEGRATION.md §D6). The historical
 * registries carry human deaths only inside free-text descriptions for 1988–2017
 * (a structured `фавтида` column exists solely for 2018–2020, loaded by D3). This
 * loader applies `casualties.csv` — human dead / injured / damage-in-somoni parsed
 * from those descriptions by an LLM pass that explicitly separated people from
 * livestock ("голов КРС/МРС"), handled word-forms ("погибла мать" = 1) and
 * excluded "пропал без вести"; the reviewed output is committed alongside.
 *
 * Enriches, never clobbers: a value is written only where the incident's field is
 * still 0 / null, so the authoritative 2018–2020 structured figures stand. Severity
 * is recomputed from the enriched figures and each incident_report snapshot resynced.
 * Idempotent (fill-if-empty + deterministic recompute); run after load:incidents.
 */

const DATA = join(__dirname, '..', 'data', 'd6-casualties');

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

async function bulkInsert(
  pool: PgPool,
  table: string,
  columns: string[],
  rows: unknown[][],
): Promise<void> {
  const chunkSize = 500;
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
    await pool.query(`create schema if not exists stg`);
    await pool.query(`drop table if exists stg.casualty_parsed`);
    await pool.query(
      `create table stg.casualty_parsed (number text primary key, dead int, injured int,
        damage_somoni numeric, note text)`,
    );
    // number,dead,injured,damage_somoni,note — empty numeric cells → null.
    const rows = parseCsv(readFileSync(join(DATA, 'casualties.csv'), 'utf8'))
      .slice(1)
      .map((r) => [r[0], r[1] || null, r[2] || null, r[3] || null, r[4] ?? '']);
    await bulkInsert(
      pool,
      'stg.casualty_parsed',
      ['number', 'dead', 'injured', 'damage_somoni', 'note'],
      rows,
    );

    const upd = await pool.query(`
      update app.incidents i set
        dead = case when i.dead = 0 and c.dead is not null then c.dead else i.dead end,
        injured = case when i.injured = 0 and c.injured is not null then c.injured else i.injured end,
        damage_est = case when i.damage_est is null and c.damage_somoni is not null then c.damage_somoni else i.damage_est end,
        updated_at = now()
      from stg.casualty_parsed c
      where c.number = i.number and i.source = 'report_doc'
    `);
    await pool.query(`
      update app.incidents set severity = case
          when dead >= 5 or coalesce(damage_est,0) >= 1000000 then 4
          when dead >= 1 or coalesce(damage_est,0) >= 100000 then 3 else 2 end
      where source = 'report_doc' and number like 'ЧС-%-и%'
    `);
    await pool.query(`
      update app.incident_reports r set dead = i.dead, injured = i.injured, damage_est = i.damage_est
      from app.incidents i
      where i.id = r.incident_id and i.source = 'report_doc' and i.number like 'ЧС-%-и%'
    `);

    const { rows: chk } = await pool.query<{
      with_dead: string;
      total_dead: string;
      with_injured: string;
    }>(`
      select count(*) filter (where dead > 0)::text with_dead, sum(dead)::text total_dead,
             count(*) filter (where injured > 0)::text with_injured
      from app.incidents where source = 'report_doc' and number like 'ЧС-%-и%'`);
    const c = chk[0];
    console.log(
      `D6 loader: applied ${rows.length} parsed rows (${upd.rowCount} incidents matched). ` +
        `Now ${c?.with_dead} incidents with deaths (Σ ${c?.total_dead}), ${c?.with_injured} with injured. ✔`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
