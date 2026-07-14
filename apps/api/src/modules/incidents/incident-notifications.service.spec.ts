import { describe, expect, it, vi } from 'vitest';
import {
  incidentRecipientRoleCodes,
  IncidentNotificationsService,
} from './incident-notifications.service';

function selectChain(result: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const method of ['from', 'innerJoin', 'where']) chain[method] = () => chain;
  chain['then'] = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return chain;
}

function makeService(recipients: { id: string }[]) {
  const db = { selectDistinct: vi.fn(() => selectChain(recipients)) };
  const notifications = { notifyMany: vi.fn().mockResolvedValue(undefined) };
  return {
    service: new IncidentNotificationsService(db as never, notifications as never),
    db,
    notifications,
  };
}

describe('IncidentNotificationsService', () => {
  it('adds leadership at severity 3 and not below the threshold', () => {
    expect(incidentRecipientRoleCodes(2)).toEqual(['duty_officer']);
    expect(incidentRecipientRoleCodes(3)).toEqual(['duty_officer', 'chief']);
    expect(incidentRecipientRoleCodes(5)).toEqual(['duty_officer', 'chief']);
  });

  it('deduplicates through the role query and includes the initiating operator', async () => {
    const c = makeService([{ id: 'actor' }, { id: 'duty-2' }]);
    await c.service.notify({
      event: 'created',
      incidentId: '01900000-0000-7000-8000-000000000001',
      number: 'ЧС-2026-0001',
      severity: 2,
      dedupeKey: 'incident:i1:created',
    });

    expect(c.notifications.notifyMany).toHaveBeenCalledWith(
      expect.objectContaining({
        userIds: ['actor', 'duty-2'],
        type: 'incidents.incident.created',
        priority: 'normal',
        emailMode: 'offline',
        payload: { number: 'ЧС-2026-0001', severity: 2 },
        entityType: 'incident',
        dedupeKey: 'incident:i1:created',
      }),
    );
  });

  it('uses the high-severity matrix and never fails the committed domain action', async () => {
    const c = makeService([{ id: 'chief-1' }]);
    c.notifications.notifyMany.mockRejectedValueOnce(new Error('notifications down'));

    await expect(
      c.service.notify({
        event: 'status_changed',
        incidentId: '01900000-0000-7000-8000-000000000001',
        number: 'ЧС-2026-0001',
        severity: 3,
        dedupeKey: 'incident:i1:status:s1',
        fromStatus: 'reported',
        toStatus: 'active',
      }),
    ).resolves.toBeUndefined();

    expect(c.db.selectDistinct).toHaveBeenCalledOnce();
  });

  it('propagates fan-out failures through the outbox delivery entry point', async () => {
    const c = makeService([{ id: 'chief-1' }]);
    c.notifications.notifyMany.mockRejectedValueOnce(new Error('notifications down'));

    await expect(
      c.service.deliver({
        event: 'created',
        incidentId: '01900000-0000-7000-8000-000000000001',
        number: 'ЧС-2026-0001',
        severity: 3,
        dedupeKey: 'incident:i1:created',
      }),
    ).rejects.toThrow('notifications down');
  });

  it('derives critical priority at severity 4 independently of the leadership threshold', async () => {
    const c = makeService([{ id: 'duty-1' }]);
    await c.service.notify({
      event: 'created',
      incidentId: '01900000-0000-7000-8000-000000000001',
      number: 'ЧС-2026-0001',
      severity: 3,
      dedupeKey: 'incident:i1:created:normal',
    });
    await c.service.notify({
      event: 'created',
      incidentId: '01900000-0000-7000-8000-000000000002',
      number: 'ЧС-2026-0002',
      severity: 4,
      dedupeKey: 'incident:i2:created:critical',
    });

    expect(c.notifications.notifyMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ priority: 'normal' }),
    );
    expect(c.notifications.notifyMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ priority: 'critical' }),
    );
  });
});
