import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  NotificationsService,
  OFFLINE_EMAIL_THRESHOLD_MS,
  planEmailDelivery,
} from './notifications.service';

/** Thenable that resolves to `result` and swallows the drizzle query-builder chain. */
function selectChain(result: unknown[]) {
  const obj: Record<string, unknown> = {};
  for (const m of ['from', 'where', 'orderBy', 'limit', 'offset']) obj[m] = () => obj;
  obj['then'] = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
    Promise.resolve(result).then(res, rej);
  return obj;
}

interface InsertedNotification {
  id: string;
  userId: string;
  type: string;
  createdAt: Date;
}

function makeService(insertedRows: InsertedNotification[] = []) {
  const values = vi.fn(() => ({
    onConflictDoNothing: () => ({ returning: () => Promise.resolve(insertedRows) }),
  }));
  const insert = vi.fn(() => ({ values }));
  const db = { select: vi.fn(), insert };
  const realtime = { emitToUser: vi.fn() };
  const mail = { send: vi.fn().mockResolvedValue(undefined) };
  const audit = { log: vi.fn() };
  const presence = {
    status: vi.fn().mockResolvedValue({ online: false, offlineForMs: Number.POSITIVE_INFINITY }),
  };
  const service = new NotificationsService(
    db as never,
    realtime as never,
    mail as never,
    audit as never,
    presence as never,
  );
  return { service, db, realtime, mail, audit, presence, values };
}

describe('NotificationsService.notify', () => {
  it('writes the in-app row and emits for a critical group', async () => {
    const row = {
      id: 'n1',
      userId: 'u1',
      type: 'docflow.route.assigned',
      createdAt: new Date('2026-07-13T00:00:00Z'),
    };
    const c = makeService([row]);
    c.db.select
      .mockReturnValueOnce(selectChain([])) // no pref rows
      .mockReturnValueOnce(selectChain([{ id: 'u1', email: null }])); // recipient email lookup

    await c.service.notify({
      userId: 'u1',
      type: 'docflow.route.assigned',
      title: 't',
      body: 'b',
      priority: 'normal',
      emailMode: 'always',
    });

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
      .mockReturnValueOnce(
        selectChain([{ userId: 'u1', typeGroup: 'chat', channel: 'inapp', enabled: false }]),
      )
      .mockReturnValueOnce(selectChain([{ id: 'u1', email: null }]));

    await c.service.notify({
      userId: 'u1',
      type: 'chat.message.mention',
      title: 't',
      body: 'b',
      priority: 'normal',
      emailMode: 'always',
    });

    expect(c.db.insert).not.toHaveBeenCalled();
    expect(c.realtime.emitToUser).not.toHaveBeenCalled();
  });

  it('sends email when the channel is on and the user has an address', async () => {
    const row = { id: 'n2', userId: 'u1', type: 'system.welcome', createdAt: new Date() };
    const c = makeService([row]);
    c.db.select
      .mockReturnValueOnce(selectChain([]))
      .mockReturnValueOnce(selectChain([{ id: 'u1', email: 'a@b.tj' }]));

    await c.service.notify({
      userId: 'u1',
      type: 'system.welcome',
      title: 'Hi',
      body: 'Body',
      priority: 'normal',
      emailMode: 'always',
    });

    expect(c.mail.send).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'a@b.tj', subject: 'Hi', text: 'Body' }),
      expect.anything(),
    );
  });

  it('deduplicates recipients and emits only for rows inserted by the bulk fan-out', async () => {
    const inserted = {
      id: 'n3',
      userId: 'u2',
      type: 'incidents.incident.created',
      createdAt: new Date('2026-07-14T00:00:00Z'),
    };
    const c = makeService([inserted]);
    c.db.select
      .mockReturnValueOnce(selectChain([]))
      .mockReturnValueOnce(selectChain([{ id: 'u2', email: null }]));

    await c.service.notifyMany({
      userIds: ['u1', 'u1', 'u2'],
      type: 'incidents.incident.created',
      title: 'Incident',
      body: 'Created',
      priority: 'normal',
      emailMode: 'always',
      payload: { number: 'ЧС-2026-0001', severity: 3 },
      dedupeKey: 'incident:i1:created',
    });

    expect(c.values).toHaveBeenCalledWith([
      expect.objectContaining({
        userId: 'u1',
        dedupeKey: 'incident:i1:created',
        payload: { number: 'ЧС-2026-0001', severity: 3 },
      }),
      expect.objectContaining({
        userId: 'u2',
        dedupeKey: 'incident:i1:created',
        payload: { number: 'ЧС-2026-0001', severity: 3 },
      }),
    ]);
    expect(c.realtime.emitToUser).toHaveBeenCalledTimes(1);
    expect(c.realtime.emitToUser).toHaveBeenCalledWith(
      'u2',
      'notify.new',
      expect.objectContaining({ id: 'n3' }),
    );
    expect(c.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        meta: expect.objectContaining({ recipientCount: 2, insertedCount: 1 }),
      }),
    );
  });

  it('honours a disabled normal incident channel but forces a critical incident in-app', async () => {
    const preference = [
      { userId: 'u1', typeGroup: 'incidents', channel: 'inapp', enabled: false },
      { userId: 'u1', typeGroup: 'incidents', channel: 'email', enabled: false },
    ];
    const normal = makeService();
    normal.db.select.mockReturnValueOnce(selectChain(preference));
    await normal.service.notify({
      userId: 'u1',
      type: 'incidents.incident.created',
      title: 'Normal',
      body: 'Normal',
      priority: 'normal',
      emailMode: 'offline',
    });
    expect(normal.db.insert).not.toHaveBeenCalled();

    const row = {
      id: 'n4',
      userId: 'u1',
      type: 'incidents.incident.created',
      createdAt: new Date('2026-07-14T00:00:00Z'),
    };
    const critical = makeService([row]);
    critical.db.select.mockReturnValueOnce(selectChain(preference));
    await critical.service.notify({
      userId: 'u1',
      type: 'incidents.incident.created',
      title: 'Critical',
      body: 'Critical',
      priority: 'critical',
      emailMode: 'offline',
    });
    expect(critical.db.insert).toHaveBeenCalledOnce();
    expect(critical.realtime.emitToUser).toHaveBeenCalledWith(
      'u1',
      'notify.new',
      expect.objectContaining({ id: 'n4' }),
    );
  });
});

describe('incident email delivery policy', () => {
  const daytime = new Date('2026-07-14T07:00:00.000Z').getTime(); // 12:00 Dushanbe
  const quietStart = new Date('2026-07-14T16:00:00.000Z').getTime(); // 21:00 Dushanbe

  it('suppresses normal email for online and recently-offline recipients', () => {
    expect(
      planEmailDelivery('normal', 'offline', { online: true, offlineForMs: 0 }, daytime),
    ).toEqual({ send: false, delayMs: 0 });
    expect(
      planEmailDelivery(
        'normal',
        'offline',
        { online: false, offlineForMs: OFFLINE_EMAIL_THRESHOLD_MS - 1_000 },
        daytime,
      ),
    ).toEqual({ send: false, delayMs: 0 });
  });

  it('sends normal email after five offline minutes and defers it through quiet hours', () => {
    const offline = { online: false, offlineForMs: OFFLINE_EMAIL_THRESHOLD_MS };
    expect(planEmailDelivery('normal', 'offline', offline, daytime)).toEqual({
      send: true,
      delayMs: 0,
    });
    expect(planEmailDelivery('normal', 'offline', offline, quietStart)).toEqual({
      send: true,
      delayMs: 10 * 60 * 60 * 1_000,
    });
  });

  it('sends critical email immediately even when online during quiet hours', () => {
    expect(
      planEmailDelivery('critical', 'offline', { online: true, offlineForMs: 0 }, quietStart),
    ).toEqual({ send: true, delayMs: 0 });
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

  it('allows disabling normal incident notifications because criticality is per event', async () => {
    const values = vi.fn(() => ({
      onConflictDoUpdate: () => Promise.resolve(),
    }));
    c.db.insert.mockReturnValue({ values } as never);
    c.db.select.mockReturnValueOnce(selectChain([]));

    await expect(
      c.service.updatePrefs('u1', {
        updates: [{ typeGroup: 'incidents', channel: 'inapp', enabled: false }],
      }),
    ).resolves.toBeDefined();
  });
});
