import { describe, expect, it, vi } from 'vitest';
import { DocflowDeadlineOutboxService } from './docflow-deadline-outbox.service';

const RES = '01900000-0000-7000-8000-000000000001';
const DOC = '01900000-0000-7000-8000-000000000002';
const USER = '01900000-0000-7000-8000-000000000003';

const payload = (over: Record<string, unknown>) => ({
  resolutionId: RES,
  documentId: DOC,
  tier: 'due0',
  subject: 'Секретная тема поручения',
  regNumber: 'Вх-2026-0007',
  dueDate: '2026-07-16T06:00:00.000Z',
  recipientUserIds: [USER],
  ...over,
});

function makeService(rowPayload: Record<string, unknown>) {
  const notifyMany = vi.fn().mockResolvedValue(undefined);
  const row = {
    id: DOC,
    payload: rowPayload,
    dedupeKey: 'docflow.deadline:r1:due0:2026-07-16',
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
  const db = { transaction: vi.fn((run: (t: typeof tx) => unknown) => run(tx)) };
  const service = new DocflowDeadlineOutboxService(db as never, { notifyMany } as never);
  return { service, notifyMany };
}

describe('DocflowDeadlineOutboxService — ДСП subject redaction (docs/09 §3)', () => {
  it('shows only the registration number for a ДСП document, never the subject', async () => {
    const c = makeService(payload({ confidential: true }));
    await c.service.dispatchPending();
    expect(c.notifyMany).toHaveBeenCalledTimes(1);
    const arg = c.notifyMany.mock.calls[0]![0] as { body: string };
    expect(arg.body).toBe('Вх-2026-0007');
    expect(arg.body).not.toContain('Секретная');
  });

  it('falls back to a generic label when a ДСП document has no registration number yet', async () => {
    const c = makeService(payload({ confidential: true, regNumber: null }));
    await c.service.dispatchPending();
    const arg = c.notifyMany.mock.calls[0]![0] as { body: string };
    expect(arg.body).toBe('Документ ДСП');
  });

  it('shows the subject for a normal (non-ДСП) document', async () => {
    const c = makeService(payload({ confidential: false }));
    await c.service.dispatchPending();
    const arg = c.notifyMany.mock.calls[0]![0] as { body: string };
    expect(arg.body).toBe('Секретная тема поручения');
  });
});
