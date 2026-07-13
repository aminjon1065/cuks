import { describe, expect, it, vi } from 'vitest';
import { AuditQueryService } from './audit-query.service';

function selectChain(result: unknown[]) {
  const obj: Record<string, unknown> = {};
  for (const m of ['from', 'where', 'orderBy', 'limit', 'offset']) obj[m] = () => obj;
  obj['then'] = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
    Promise.resolve(result).then(res, rej);
  return obj;
}

describe('AuditQueryService.list', () => {
  it('returns a paginated, mapped result', async () => {
    const row = {
      id: 'a1',
      actorId: 'u1',
      action: 'auth.login.success',
      entityType: null,
      entityId: null,
      orgUnitId: null,
      ip: '10.0.0.1',
      userAgent: 'UA',
      meta: { x: 1 },
      createdAt: new Date('2026-07-13T00:00:00Z'),
    };
    const select = vi
      .fn()
      .mockReturnValueOnce(selectChain([{ total: 1 }])) // count
      .mockReturnValueOnce(selectChain([row])); // page
    const service = new AuditQueryService({ select } as never);

    const result = await service.list({ page: 1, limit: 50, action: 'auth.' } as never);

    expect(result.total).toBe(1);
    expect(result.items[0]).toMatchObject({
      id: 'a1',
      action: 'auth.login.success',
      createdAt: '2026-07-13T00:00:00.000Z',
    });
  });
});
