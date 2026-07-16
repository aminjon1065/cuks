import { describe, expect, it, vi } from 'vitest';
import { TaskDeadlineOutboxService } from './task-deadline-outbox.service';

const TASK = '01900000-0000-7000-8000-000000000001';
const PROJECT = '01900000-0000-7000-8000-000000000002';
const MEMBER = '01900000-0000-7000-8000-000000000003';
const OUTSIDER = '01900000-0000-7000-8000-000000000004';

const payload = (over: Record<string, unknown>) => ({
  taskId: TASK,
  projectId: PROJECT,
  projectKey: 'ОПЕР',
  seq: 42,
  title: 'Отработать донесение',
  tier: 'due_today',
  recipientUserIds: [MEMBER, OUTSIDER],
  ...over,
});

/** A stub db: the outbox claim runs inside `transaction`; the member filter is a plain `select`. */
function makeService(rowPayload: Record<string, unknown>, memberRows: { userId: string }[]) {
  const notifyMany = vi.fn().mockResolvedValue(undefined);
  const row = {
    id: TASK,
    payload: rowPayload,
    dedupeKey: 'tasks.deadline:t1:due_today:2026-07-16',
    attempts: 0,
  };
  const tx = {
    select: vi.fn(() => {
      const chain: Record<string, unknown> = {};
      for (const m of ['from', 'where', 'orderBy', 'limit']) chain[m] = vi.fn(() => chain);
      chain['for'] = vi.fn().mockResolvedValue([row]);
      return chain;
    }),
    update: vi.fn(() => ({
      set: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })),
    })),
  };
  const db = {
    transaction: vi.fn((run: (t: typeof tx) => unknown) => run(tx)),
    // The recipient membership filter in deliver().
    select: vi.fn(() => ({
      from: vi.fn(() => ({ where: vi.fn().mockResolvedValue(memberRows) })),
    })),
  };
  const service = new TaskDeadlineOutboxService(db as never, { notifyMany } as never);
  return { service, notifyMany };
}

describe('TaskDeadlineOutboxService — member-filtered delivery (docs/modules/15 §7)', () => {
  it('delivers only to recipients who are current project members', async () => {
    const c = makeService(payload({}), [{ userId: MEMBER }]);
    await c.service.dispatchPending();
    expect(c.notifyMany).toHaveBeenCalledTimes(1);
    const arg = c.notifyMany.mock.calls[0]![0] as { userIds: string[]; type: string; body: string };
    expect(arg.userIds).toEqual([MEMBER]); // the non-member is filtered out
    expect(arg.type).toBe('tasks.deadline.due_today');
    expect(arg.body).toBe('Отработать донесение');
  });

  it('sends nothing when no recipient is a member (a stale assignee never gets the card title)', async () => {
    const c = makeService(payload({}), []);
    await c.service.dispatchPending();
    expect(c.notifyMany).not.toHaveBeenCalled();
  });

  it('resolves the notification type from the tier', async () => {
    const c = makeService(payload({ tier: 'due_soon' }), [{ userId: MEMBER }]);
    await c.service.dispatchPending();
    expect((c.notifyMany.mock.calls[0]![0] as { type: string }).type).toBe(
      'tasks.deadline.due_soon',
    );
  });
});
