import { describe, expect, it, vi } from 'vitest';
import { DocflowNumberingService, formatRegNumber } from './docflow-numbering.service';

describe('formatRegNumber', () => {
  const parts = { year: 2026, month: 3, seq: 7 };

  it('renders year, month and a padded sequence', () => {
    expect(formatRegNumber('{YYYY}/{seq4}', parts)).toBe('2026/0007');
    expect(formatRegNumber('{YY}-{MM}-{seq3}', parts)).toBe('26-03-007');
  });

  it('treats any other braced token as a literal prefix', () => {
    expect(formatRegNumber('{П}-{YYYY}/{seq4}', parts)).toBe('П-2026/0007');
    expect(formatRegNumber('{ВХ}-{seq2}', { ...parts, seq: 5 })).toBe('ВХ-05');
  });

  it('does not overflow a sequence wider than the pad', () => {
    expect(formatRegNumber('{seq2}', { ...parts, seq: 1234 })).toBe('1234');
  });

  it('keeps literal text outside braces verbatim', () => {
    expect(formatRegNumber('ORD {YYYY} #{seq4}', parts)).toBe('ORD 2026 #0007');
  });
});

/** A tx double whose insert/onConflict/returning chain yields the given seq. */
function fakeTx(lastSeq: number) {
  const captured: { values?: unknown; conflict?: unknown } = {};
  const tx = {
    insert: () => ({
      values: (v: unknown) => {
        captured.values = v;
        return {
          onConflictDoUpdate: (c: unknown) => {
            captured.conflict = c;
            return { returning: () => Promise.resolve([{ lastSeq }]) };
          },
        };
      },
    }),
  };
  return { tx, captured };
}

describe('DocflowNumberingService.allocate', () => {
  it('buckets a yearly journal under the calendar year and formats the number', async () => {
    const svc = new DocflowNumberingService();
    const { tx, captured } = fakeTx(42);
    const now = new Date('2026-07-15T00:00:00Z');
    const result = await svc.allocate(
      tx as never,
      { id: 'j1', numberTemplate: '{П}-{YYYY}/{seq4}', seqReset: 'yearly' },
      now,
    );
    expect(result).toEqual({ number: 'П-2026/0042', year: 2026, seq: 42 });
    expect((captured.values as { year: number }).year).toBe(2026);
  });

  it('buckets a continuous journal under year 0', async () => {
    const svc = new DocflowNumberingService();
    const { tx, captured } = fakeTx(101);
    const result = await svc.allocate(
      tx as never,
      { id: 'j2', numberTemplate: '{seq5}', seqReset: 'never' },
      new Date('2026-07-15T00:00:00Z'),
    );
    expect(result).toEqual({ number: '00101', year: 0, seq: 101 });
    expect((captured.values as { year: number }).year).toBe(0);
  });

  it('increments the counter atomically (ON CONFLICT DO UPDATE, not a read-then-write)', async () => {
    const svc = new DocflowNumberingService();
    const spy = vi.fn(() => ({ returning: () => Promise.resolve([{ lastSeq: 1 }]) }));
    const tx = { insert: () => ({ values: () => ({ onConflictDoUpdate: spy }) }) };
    await svc.allocate(
      tx as never,
      { id: 'j3', numberTemplate: '{seq4}', seqReset: 'yearly' },
      new Date('2026-01-01T00:00:00Z'),
    );
    expect(spy).toHaveBeenCalledOnce();
  });
});

describe('DocflowNumberingService.allocate — Asia/Dushanbe registration period', () => {
  const journal = { id: 'j', numberTemplate: '{YYYY}-{MM}/{seq4}', seqReset: 'yearly' } as const;

  /** Mints under whatever period `allocate` derives from `now`; the seq is fixed. */
  async function allocateAt(now: string): Promise<{ number: string; year: number }> {
    const svc = new DocflowNumberingService();
    const { tx } = fakeTx(1);
    const { number, year } = await svc.allocate(tx as never, journal, new Date(now));
    return { number, year };
  }

  it('files the last five hours of 31 December under the NEXT year', async () => {
    // 19:00Z is midnight in Dushanbe: 2026-12-31T19:30Z is already 1 January 2027 locally,
    // so the chancellery's book has turned over even though UTC still says 2026.
    expect(await allocateAt('2026-12-31T19:30:00.000Z')).toEqual({
      number: '2027-01/0001',
      year: 2027,
    });
  });

  it('stays in the outgoing year right up to the local midnight', async () => {
    expect(await allocateAt('2026-12-31T18:59:59.999Z')).toEqual({
      number: '2026-12/0001',
      year: 2026,
    });
  });

  it('turns the month over at the local midnight, not the UTC one', async () => {
    expect((await allocateAt('2026-03-31T18:59:59.999Z')).number).toBe('2026-03/0001');
    expect((await allocateAt('2026-03-31T19:00:00.000Z')).number).toBe('2026-04/0001');
  });

  it('handles the leap day and the following non-leap February', async () => {
    expect(await allocateAt('2024-02-29T10:00:00.000Z')).toEqual({
      number: '2024-02/0001',
      year: 2024,
    });
    expect((await allocateAt('2024-02-29T19:00:00.000Z')).number).toBe('2024-03/0001');
    expect((await allocateAt('2027-02-28T19:00:00.000Z')).number).toBe('2027-03/0001');
  });

  it('keeps a continuous journal in bucket 0 across the year boundary', async () => {
    const svc = new DocflowNumberingService();
    const { tx, captured } = fakeTx(7);
    const result = await svc.allocate(
      tx as never,
      { id: 'j-cont', numberTemplate: '{YYYY}/{seq4}', seqReset: 'never' },
      new Date('2026-12-31T19:30:00.000Z'),
    );
    // The counter is shared (bucket 0) but the rendered number still shows the local year.
    expect(result).toEqual({ number: '2027/0007', year: 0, seq: 7 });
    expect((captured.values as { year: number }).year).toBe(0);
  });
});

describe('DocflowNumberingService.allocate — concurrent registrations', () => {
  /**
   * 50 registrations racing on one journal. The tx double models what PostgreSQL
   * guarantees — `INSERT … ON CONFLICT DO UPDATE … RETURNING` is one atomic statement —
   * and yields to the event loop around it so the *service* code interleaves. It proves
   * `allocate` keeps no cross-call state and spends exactly one statement per number;
   * the real row-lock serialisation is covered end-to-end against PostgreSQL by
   * `apps/web/e2e/docflow-acceptance.spec.ts` («50 concurrent registrations»).
   */
  it('mints 50 unique, gap-free numbers in the local-calendar bucket', async () => {
    const counters = new Map<string, number>();
    const statements: string[] = [];
    const tx = {
      insert: () => ({
        values: (v: { journalId: string; year: number }) => ({
          onConflictDoUpdate: () => ({
            returning: async () => {
              await Promise.resolve(); // let other in-flight allocations interleave
              const key = `${v.journalId}:${v.year}`;
              const next = (counters.get(key) ?? 0) + 1; // atomic in PostgreSQL, single statement here
              counters.set(key, next);
              statements.push(key);
              return [{ lastSeq: next }];
            },
          }),
        }),
      }),
    };

    const svc = new DocflowNumberingService();
    const now = new Date('2026-12-31T19:30:00.000Z'); // already 2027 in Dushanbe
    const results = await Promise.all(
      Array.from({ length: 50 }, () =>
        svc.allocate(
          tx as never,
          { id: 'race', numberTemplate: '{YYYY}/{seq4}', seqReset: 'yearly' },
          now,
        ),
      ),
    );

    const seqs = results.map((r) => r.seq).sort((a, b) => a - b);
    expect(seqs).toEqual(Array.from({ length: 50 }, (_, i) => i + 1)); // unique and gap-free
    expect(new Set(results.map((r) => r.number)).size).toBe(50);
    expect(results.every((r) => r.year === 2027)).toBe(true);
    expect(results.map((r) => r.number)).toContain('2027/0050');
    expect(statements).toHaveLength(50); // exactly one counter statement per number
    expect(new Set(statements)).toEqual(new Set(['race:2027'])); // all in one period bucket
  });
});
