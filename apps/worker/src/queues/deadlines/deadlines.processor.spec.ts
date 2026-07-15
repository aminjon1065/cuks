import { describe, expect, it, vi } from 'vitest';
import { resolutions, userPositions } from '@cuks/db';
import { DeadlinesProcessor } from './deadlines.processor';

/**
 * A minimal chainable Drizzle stub. Reads (select/selectDistinct → from → …joins… → where)
 * resolve to a result keyed on the `from` table; writes (insert → values → onConflict →
 * returning) record the row and resolve to one inserted id.
 */
function makeDb(scanRows: unknown[], headRows: { userId: string }[]) {
  const inserted: Array<{ topic: string; payload: unknown; dedupeKey: string }> = [];

  const reader = () => {
    let table: unknown = null;
    const chain: Record<string, unknown> = {
      from(t: unknown) {
        table = t;
        return chain;
      },
      innerJoin() {
        return chain;
      },
      where() {
        return Promise.resolve(table === userPositions ? headRows : scanRows);
      },
    };
    return chain;
  };

  const db = {
    select: reader,
    selectDistinct: reader,
    insert() {
      let values: { topic: string; payload: unknown; dedupeKey: string };
      return {
        values(v: { topic: string; payload: unknown; dedupeKey: string }) {
          values = v;
          return this;
        },
        onConflictDoNothing() {
          return this;
        },
        returning() {
          inserted.push(values);
          return Promise.resolve([{ id: 'outbox-1' }]);
        },
      };
    },
  };
  return { db, inserted };
}

const resolutionRow = (over: Partial<Record<string, unknown>>) => ({
  resolutionId: 'r1',
  documentId: 'd1',
  executorId: 'exec',
  authorId: 'author',
  subject: 'Приказ',
  dueDate: new Date('2026-07-15T06:00:00.000Z'),
  ...over,
});

const NOW = new Date('2026-07-15T06:00:00.000Z'); // due today for the base row

async function run(scanRows: unknown[], headRows: { userId: string }[] = []) {
  const { db, inserted } = makeDb(scanRows, headRows);
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  const proc = new DeadlinesProcessor(db as never);
  await proc.process({ id: 'job1' } as never);
  vi.useRealTimers();
  return inserted;
}

describe('DeadlinesProcessor', () => {
  it('reminds only the executor when the deadline is today', async () => {
    const inserted = await run([resolutionRow({})]);
    expect(inserted).toHaveLength(1);
    const payload = inserted[0]!.payload as { tier: string; recipientUserIds: string[] };
    expect(payload.tier).toBe('due0');
    expect(payload.recipientUserIds).toEqual(['exec']);
    expect(inserted[0]!.dedupeKey).toContain('docflow.deadline:r1:due0:');
  });

  it('reminds executor and author once overdue', async () => {
    const inserted = await run([resolutionRow({ dueDate: new Date('2026-07-13T06:00:00.000Z') })]);
    expect(inserted).toHaveLength(1);
    const payload = inserted[0]!.payload as { tier: string; recipientUserIds: string[] };
    expect(payload.tier).toBe('overdue');
    expect(payload.recipientUserIds.sort()).toEqual(['author', 'exec']);
  });

  it('escalates to the subdivision head past 5 days overdue (plus the overdue reminder)', async () => {
    const inserted = await run(
      [resolutionRow({ dueDate: new Date('2026-07-08T06:00:00.000Z') })], // 7 days overdue
      [{ userId: 'head' }],
    );
    const tiers = inserted.map((r) => (r.payload as { tier: string }).tier).sort();
    expect(tiers).toEqual(['escalation', 'overdue']);
    const esc = inserted.find((r) => (r.payload as { tier: string }).tier === 'escalation')!;
    expect((esc.payload as { recipientUserIds: string[] }).recipientUserIds).toEqual(['head']);
  });

  it('emits nothing on a quiet day (2 days out, not a reminder tier)', async () => {
    const inserted = await run([resolutionRow({ dueDate: new Date('2026-07-17T06:00:00.000Z') })]);
    expect(inserted).toHaveLength(0);
  });
});

// Touch the imports so the stub table identities line up with the processor's queries.
void resolutions;
void userPositions;
