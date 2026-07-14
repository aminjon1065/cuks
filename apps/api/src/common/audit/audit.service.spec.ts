import { describe, expect, it, vi } from 'vitest';
import { AuditService } from './audit.service';
import { requestContext } from '../request-context/request-context';

function makeService(reject = false) {
  const values = reject
    ? vi.fn().mockRejectedValue(new Error('db down'))
    : vi.fn().mockResolvedValue(undefined);
  const insert = vi.fn(() => ({ values }));
  const service = new AuditService({ insert } as never);
  return { service, insert, values };
}

const flush = (): Promise<void> => new Promise((r) => setImmediate(r));

describe('AuditService', () => {
  it('persists the event enriched from the request context', async () => {
    const { service, values } = makeService();
    requestContext.run({ ip: '10.0.0.1', userAgent: 'UA', actorId: 'u1' }, () => {
      service.log({ action: 'admin.thing.created', entityType: 'thing', entityId: 'e1' });
    });
    await flush();
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'admin.thing.created',
        actorId: 'u1',
        ip: '10.0.0.1',
        userAgent: 'UA',
        entityType: 'thing',
        entityId: 'e1',
      }),
    );
  });

  it('prefers an explicit actor/ip over the context', async () => {
    const { service, values } = makeService();
    requestContext.run({ ip: 'ctxIp', userAgent: 'ctxUA', actorId: 'ctxUser' }, () => {
      service.log({ action: 'auth.login.success', actorId: 'explicit', ip: 'explicitIp' });
    });
    await flush();
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: 'explicit', ip: 'explicitIp' }),
    );
  });

  it('falls back to nulls with no request context', async () => {
    const { service, values } = makeService();
    service.log({ action: 'system.job.ran' });
    await flush();
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: null, ip: null, userAgent: null }),
    );
  });

  it('never throws when the insert fails (fire-and-forget)', async () => {
    const { service } = makeService(true);
    expect(() => service.log({ action: 'x.y.z' })).not.toThrow();
    await flush();
  });

  it('can await timeline-critical persistence without propagating a DB failure', async () => {
    const ok = makeService();
    await ok.service.logAndWait({ action: 'incidents.incident.status_changed' });
    expect(ok.values).toHaveBeenCalledOnce();

    const failing = makeService(true);
    await expect(
      failing.service.logAndWait({ action: 'incidents.incident.status_changed' }),
    ).resolves.toBeUndefined();
  });
});
