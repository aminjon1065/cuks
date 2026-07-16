import { describe, expect, it, vi } from 'vitest';
import { resolutions, tasks, userPositions } from '@cuks/db';
import { DeadlinesProcessor } from './deadlines.processor';

/**
 * A minimal chainable Drizzle stub. Reads (select/selectDistinct → from → …joins… → where)
 * resolve to a result keyed on the `from` table; writes (insert → values → onConflict →
 * returning) record the row and resolve to one inserted id.
 */
function makeDb(scanRows: unknown[], headRows: { userId: string }[], taskRows: unknown[] = []) {
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
        return Promise.resolve(
          table === userPositions ? headRows : table === tasks ? taskRows : scanRows,
        );
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
  confidentiality: 'normal',
  docAuthorId: 'author',
  accessList: [] as string[],
  ...over,
});

const NOW = new Date('2026-07-15T06:00:00.000Z'); // due today for the base row

async function run(
  scanRows: unknown[],
  headRows: { userId: string }[] = [],
  taskRows: unknown[] = [],
) {
  const { db, inserted } = makeDb(scanRows, headRows, taskRows);
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  const proc = new DeadlinesProcessor(db as never);
  await proc.process({ id: 'job1' } as never);
  vi.useRealTimers();
  return inserted;
}

const taskRow = (over: Partial<Record<string, unknown>>) => ({
  taskId: 't1',
  projectId: 'p1',
  projectKey: 'ОПЕР',
  seq: 42,
  title: 'Задача',
  dueAt: new Date('2026-07-15T06:00:00.000Z'), // due today for the base row
  assigneeIds: ['exec'] as string[],
  authorId: 'author',
  ...over,
});
const taskInserts = (rows: Array<{ topic: string; payload: unknown; dedupeKey: string }>) =>
  rows.filter((r) => r.topic === 'tasks.deadline');

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

  it('does not escalate a ДСП document to a head outside the allow-list', async () => {
    const inserted = await run(
      [
        resolutionRow({
          dueDate: new Date('2026-07-08T06:00:00.000Z'), // 7 days overdue → escalation tier
          confidentiality: 'dsp',
          docAuthorId: 'author',
          accessList: [], // the head is not access-listed
        }),
      ],
      [{ userId: 'head' }],
    );
    const tiers = inserted.map((r) => (r.payload as { tier: string }).tier);
    // The overdue reminder (executor + author, both participants) still fires; the escalation
    // to the uncleared head is dropped so the ДСП subject never reaches them.
    expect(tiers).toEqual(['overdue']);
  });

  it('escalates a ДСП document to a head who is on the allow-list', async () => {
    const inserted = await run(
      [
        resolutionRow({
          dueDate: new Date('2026-07-08T06:00:00.000Z'),
          confidentiality: 'dsp',
          accessList: ['head'], // the head has clearance
        }),
      ],
      [{ userId: 'head' }],
    );
    const esc = inserted.find((r) => (r.payload as { tier: string }).tier === 'escalation');
    expect(esc, 'a cleared head is still escalated to').toBeTruthy();
    expect((esc!.payload as { recipientUserIds: string[] }).recipientUserIds).toEqual(['head']);
  });

  it('reminds the assignees a day before and on the due day', async () => {
    const soon = taskInserts(
      await run([], [], [taskRow({ dueAt: new Date('2026-07-16T06:00:00.000Z') })]),
    );
    expect(soon).toHaveLength(1);
    expect(soon[0]!.payload as { tier: string; recipientUserIds: string[] }).toMatchObject({
      tier: 'due_soon',
      recipientUserIds: ['exec'],
    });
    expect(soon[0]!.dedupeKey).toContain('tasks.deadline:t1:due_soon:');

    const today = taskInserts(await run([], [], [taskRow({})]));
    expect((today[0]!.payload as { tier: string }).tier).toBe('due_today');
  });

  it('reminds assignees and author once a task is overdue', async () => {
    const inserted = taskInserts(
      await run([], [], [taskRow({ dueAt: new Date('2026-07-13T06:00:00.000Z') })]),
    );
    expect(inserted).toHaveLength(1);
    const payload = inserted[0]!.payload as { tier: string; recipientUserIds: string[] };
    expect(payload.tier).toBe('overdue');
    expect(payload.recipientUserIds.sort()).toEqual(['author', 'exec']);
  });

  it('emits no task reminder two days out, and skips a reminder with no assignees', async () => {
    expect(
      taskInserts(await run([], [], [taskRow({ dueAt: new Date('2026-07-17T06:00:00.000Z') })])),
    ).toHaveLength(0);
    // Due today but unassigned → nothing to remind.
    expect(taskInserts(await run([], [], [taskRow({ assigneeIds: [] })]))).toHaveLength(0);
  });
});

// Touch the imports so the stub table identities line up with the processor's queries.
void resolutions;
void tasks;
void userPositions;
