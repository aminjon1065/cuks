import { sql } from 'drizzle-orm';
import { createDb } from './client';

/**
 * Fill the register with a realistic volume so the stage-9 performance budgets can be
 * MEASURED rather than assumed (plan этап 9: 200 000 documents, p95 реестра < 500 мс,
 * p95 search < 1 с, dashboard < 1 с, ни одного N+1).
 *
 * Generated in SQL, not row by row from Node: two hundred thousand round-trips would take
 * longer than the thing being measured. The subjects are drawn from a small phrase bank so
 * the text-search vector has genuine Russian morphology to chew on — a table of «Документ N»
 * would make every search either match everything or nothing, and measure neither.
 *
 * Idempotent by prefix: rows are tagged in `summary` and dropped before a re-run, so this
 * never mixes with seed or demo data and never accumulates.
 */
const PERF_TAG = 'PERF-DOC-SEED';
const DEFAULT_COUNT = 200_000;

const SUBJECT_HEADS = [
  'О ликвидации последствий наводнения',
  'О мерах по предупреждению паводка',
  'Об организации дежурства',
  'О проверке готовности сил и средств',
  'О выделении финансовых средств',
  'Об эвакуации населения',
  'О результатах обследования гидротехнических сооружений',
  'О проведении командно-штабного учения',
];
const SUBJECT_TAILS = [
  'в Согдийской области',
  'в городе Душанбе',
  'в Хатлонской области',
  'в районах республиканского подчинения',
  'в Горно-Бадахшанской автономной области',
];

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  const count = Number(process.argv[2] ?? DEFAULT_COUNT);
  const { db, pool } = createDb(url);

  try {
    const [author] = (
      await db.execute<{ id: string }>(sql`select id from app.users order by created_at limit 1`)
    ).rows;
    if (!author) throw new Error('no users — run db:seed first');

    const removed = await db.execute(
      sql`delete from app.documents where summary like ${`${PERF_TAG}%`}`,
    );
    console.log(`removed ${removed.rowCount ?? 0} rows from a previous run`);

    // Parenthesised: Postgres will not subscript an array CONSTRUCTOR directly —
    // `(array[…])[i]` parses, `array[…][i]` does not.
    const heads = sql.raw(`(array[${SUBJECT_HEADS.map((s) => `'${s}'`).join(',')}])`);
    const tails = sql.raw(`(array[${SUBJECT_TAILS.map((s) => `'${s}'`).join(',')}])`);
    const started = Date.now();

    // One statement. `generate_series` drives the whole insert, so the vector and every index
    // are built by the server without a single row crossing the wire.
    await db.execute(sql`
      insert into app.documents
        (id, doc_class, type_code, subject, summary, status, confidentiality,
         author_id, reg_number, reg_date, due_date, created_at)
      select
        -- The application mints UUIDv7 client-side; here a v4 is enough, because nothing in
        -- the measured queries reads meaning from the id — the tie-breaker only needs a total
        -- order, and created_at carries the time.
        gen_random_uuid(),
        (array['incoming','outgoing','internal','citizens'])[1 + (i % 4)],
        (array['letter','order','report','memo'])[1 + (i % 4)],
        ${heads}[1 + (i % ${SUBJECT_HEADS.length})] || ' ' ||
          ${tails}[1 + (i % ${SUBJECT_TAILS.length})] || ' № ' || i,
        ${PERF_TAG} || ' наполнение реестра для замера производительности, запись ' || i,
        (array['registered','in_progress','completed','archived'])[1 + (i % 4)],
        -- One in fifty is ДСП, so the visibility predicate has something to exclude.
        case when i % 50 = 0 then 'dsp' else 'normal' end,
        ${author.id}::uuid,
        'PERF-' || to_char(2020 + (i % 6), 'FM0000') || '/' || to_char(i, 'FM000000'),
        timestamptz '2020-01-01 00:00:00+05' + (i % 2190) * interval '1 day',
        timestamptz '2020-01-01 00:00:00+05' + (i % 2190) * interval '1 day' + interval '10 days',
        timestamptz '2020-01-01 00:00:00+05' + (i % 2190) * interval '1 day'
      from generate_series(1, ${count}) as i
    `);
    await db.execute(sql`analyze app.documents`);

    const [total] = (
      await db.execute<{ n: number }>(sql`select count(*)::int as n from app.documents`)
    ).rows;
    console.log(
      `inserted ${count} documents in ${Math.round((Date.now() - started) / 1000)}s; register now holds ${total?.n ?? 0}`,
    );
  } finally {
    await pool.end();
  }
}

void main();
