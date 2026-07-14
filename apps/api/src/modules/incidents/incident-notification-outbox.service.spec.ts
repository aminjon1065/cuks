import { describe, expect, it, vi } from 'vitest';
import {
  incidentNotificationOutboxValues,
  IncidentNotificationOutboxService,
  notificationOutboxRetryAt,
} from './incident-notification-outbox.service';

const payload = {
  event: 'created' as const,
  incidentId: '01900000-0000-7000-8000-000000000001',
  number: 'ЧС-2026-0001',
  severity: 3,
  dedupeKey: 'incident:i1:created',
};

function makeService(deliver = vi.fn().mockResolvedValue(undefined)) {
  const row = {
    id: '01900000-0000-7000-8000-000000000002',
    payload,
    attempts: 0,
  };
  const updates: Record<string, unknown>[] = [];
  const tx = {
    select: vi.fn(() => {
      const chain: Record<string, unknown> = {};
      for (const method of ['from', 'where', 'orderBy', 'limit']) {
        chain[method] = vi.fn(() => chain);
      }
      chain['for'] = vi.fn().mockResolvedValue([row]);
      return chain;
    }),
    update: vi.fn(() => ({
      set: vi.fn((value: Record<string, unknown>) => {
        updates.push(value);
        return { where: vi.fn().mockResolvedValue(undefined) };
      }),
    })),
  };
  const db = {
    transaction: vi.fn((run: (transaction: typeof tx) => unknown) => run(tx)),
  };
  return {
    service: new IncidentNotificationOutboxService(db as never, { deliver } as never),
    deliver,
    updates,
  };
}

describe('IncidentNotificationOutboxService', () => {
  it('builds a durable marker with the same stable downstream dedupe key', () => {
    expect(incidentNotificationOutboxValues(payload)).toEqual({
      topic: 'incidents.notification',
      payload,
      dedupeKey: payload.dedupeKey,
    });
  });

  it('moves a claimed pending event to processed after delivery succeeds', async () => {
    const c = makeService();

    await expect(c.service.dispatchPending()).resolves.toEqual({ processed: 1, failed: 0 });

    expect(c.deliver).toHaveBeenCalledWith(payload);
    expect(c.updates).toHaveLength(1);
    expect(c.updates[0]).toMatchObject({ processedAt: expect.any(Date), lastError: null });
  });

  it('keeps a failed event pending and records retry metadata', async () => {
    const c = makeService(vi.fn().mockRejectedValue(new Error('fan-out unavailable')));

    await expect(c.service.dispatchPending()).resolves.toEqual({ processed: 0, failed: 1 });

    expect(c.updates).toHaveLength(1);
    expect(c.updates[0]).toMatchObject({
      attempts: 1,
      nextAttemptAt: expect.any(Date),
      lastError: 'fan-out unavailable',
    });
    expect(c.updates[0]).not.toHaveProperty('processedAt');
  });

  it('reuses the domain dedupe key if delivery is repeated after an ambiguous failure', async () => {
    const c = makeService();

    await c.service.dispatchPending();
    await c.service.dispatchPending();

    expect(c.deliver).toHaveBeenCalledTimes(2);
    expect(c.deliver.mock.calls[0]?.[0].dedupeKey).toBe(payload.dedupeKey);
    expect(c.deliver.mock.calls[1]?.[0].dedupeKey).toBe(payload.dedupeKey);
  });

  it('uses capped exponential retry delays', () => {
    const now = new Date('2026-07-14T12:00:00.000Z');
    expect(notificationOutboxRetryAt(1, now).toISOString()).toBe('2026-07-14T12:00:02.000Z');
    expect(notificationOutboxRetryAt(2, now).toISOString()).toBe('2026-07-14T12:00:04.000Z');
    expect(notificationOutboxRetryAt(99, now).toISOString()).toBe('2026-07-14T12:05:00.000Z');
  });
});
