import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationsService } from './notifications.service';

/** Thenable that resolves to `result` and swallows the drizzle query-builder chain. */
function selectChain(result: unknown[]) {
  const obj: Record<string, unknown> = {};
  for (const m of ['from', 'where', 'orderBy', 'limit', 'offset']) obj[m] = () => obj;
  obj['then'] = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
    Promise.resolve(result).then(res, rej);
  return obj;
}

function makeService(insertedRow?: { id: string; type: string; createdAt: Date }) {
  const insert = vi.fn(() => ({
    values: () => ({ returning: () => Promise.resolve(insertedRow ? [insertedRow] : []) }),
  }));
  const db = { select: vi.fn(), insert };
  const realtime = { emitToUser: vi.fn() };
  const mail = { send: vi.fn().mockResolvedValue(undefined) };
  const audit = { log: vi.fn() };
  const service = new NotificationsService(
    db as never,
    realtime as never,
    mail as never,
    audit as never,
  );
  return { service, db, realtime, mail, audit };
}

describe('NotificationsService.notify', () => {
  it('writes the in-app row and emits for a critical group', async () => {
    const row = {
      id: 'n1',
      type: 'docflow.route.assigned',
      createdAt: new Date('2026-07-13T00:00:00Z'),
    };
    const c = makeService(row);
    c.db.select
      .mockReturnValueOnce(selectChain([])) // no pref rows
      .mockReturnValueOnce(selectChain([{ email: null }])); // recipient email lookup

    await c.service.notify({ userId: 'u1', type: 'docflow.route.assigned', title: 't', body: 'b' });

    expect(c.db.insert).toHaveBeenCalled();
    expect(c.realtime.emitToUser).toHaveBeenCalledWith('u1', 'notify.new', {
      id: 'n1',
      type: 'docflow.route.assigned',
      createdAt: row.createdAt.toISOString(),
    });
    expect(c.mail.send).not.toHaveBeenCalled(); // no email address
  });

  it('skips the in-app row when the user disabled a non-critical in-app channel', async () => {
    const c = makeService();
    c.db.select
      .mockReturnValueOnce(selectChain([{ typeGroup: 'chat', channel: 'inapp', enabled: false }]))
      .mockReturnValueOnce(selectChain([{ email: null }]));

    await c.service.notify({ userId: 'u1', type: 'chat.message.mention', title: 't', body: 'b' });

    expect(c.db.insert).not.toHaveBeenCalled();
    expect(c.realtime.emitToUser).not.toHaveBeenCalled();
  });

  it('sends email when the channel is on and the user has an address', async () => {
    const row = { id: 'n2', type: 'system.welcome', createdAt: new Date() };
    const c = makeService(row);
    c.db.select
      .mockReturnValueOnce(selectChain([]))
      .mockReturnValueOnce(selectChain([{ email: 'a@b.tj' }]));

    await c.service.notify({ userId: 'u1', type: 'system.welcome', title: 'Hi', body: 'Body' });

    expect(c.mail.send).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'a@b.tj', subject: 'Hi', text: 'Body' }),
    );
  });
});

describe('NotificationsService.updatePrefs', () => {
  let c: ReturnType<typeof makeService>;
  beforeEach(() => {
    c = makeService();
  });

  it('rejects disabling in-app of a critical group', async () => {
    await expect(
      c.service.updatePrefs('u1', {
        updates: [{ typeGroup: 'docflow', channel: 'inapp', enabled: false }],
      }),
    ).rejects.toMatchObject({ code: 'notifications.pref.locked' });
    expect(c.db.insert).not.toHaveBeenCalled();
  });
});
