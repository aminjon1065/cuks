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

describe('DocflowNumberingService.allocate', () => {
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
