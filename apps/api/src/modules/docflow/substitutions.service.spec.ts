import { afterEach, describe, expect, it, vi } from 'vitest';
import { SubstitutionsService } from './substitutions.service';
import type { AuthUser } from '../../common/auth/auth-user';

const NOW = new Date('2026-07-15T12:00:00.000Z');

function makeDb(rows: unknown[]) {
  const chain: Record<string, unknown> = {
    from: () => chain,
    leftJoin: () => chain,
    where: () => chain,
    orderBy: () => Promise.resolve(rows),
    limit: () => Promise.resolve(rows),
  };
  return {
    select: () => chain,
    insert: () => ({ values: () => ({ returning: () => Promise.resolve([{ id: 'sub-1' }]) }) }),
    update: () => ({ set: () => ({ where: () => Promise.resolve(undefined) }) }),
  };
}

const audit = { log: vi.fn() } as never;
const user = (over: Partial<AuthUser>): AuthUser =>
  ({ id: 'me', permissions: [], isSuperadmin: false, ...over }) as AuthUser;

const row = (over: Record<string, unknown>) => ({
  id: 's1',
  principalId: 'p1',
  principalName: 'И. Принципал',
  deputyId: 'me',
  deputyName: 'Я. Заместитель',
  scope: 'docflow',
  startsAt: null,
  endsAt: null,
  isActive: true,
  createdAt: NOW,
  ...over,
});

afterEach(() => vi.useRealTimers());

describe('SubstitutionsService — active window', () => {
  const withNow = () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  };

  it('marks an open-ended active substitution as effective now', async () => {
    withNow();
    const svc = new SubstitutionsService(makeDb([row({})]) as never, audit);
    const [dto] = await svc.list(user({}));
    expect(dto!.active).toBe(true);
  });

  it('is not effective before the window starts, after it ends, or when the flag is off', async () => {
    withNow();
    const svc = new SubstitutionsService(
      makeDb([
        row({ id: 'future', startsAt: new Date('2026-07-20T00:00:00Z') }),
        row({ id: 'past', endsAt: new Date('2026-07-10T00:00:00Z') }),
        row({ id: 'off', isActive: false }),
      ]) as never,
      audit,
    );
    const dtos = await svc.list(user({}));
    expect(dtos.every((d) => d.active === false)).toBe(true);
  });
});

describe('SubstitutionsService — authorization', () => {
  it('forbids a non-admin from delegating another person’s duties', async () => {
    const svc = new SubstitutionsService(makeDb([]) as never, audit);
    await expect(
      svc.create({ principalId: 'someone-else', deputyId: 'me', scope: 'docflow' }, user({})),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('lets a user delegate their OWN duties', async () => {
    const svc = new SubstitutionsService(makeDb([row({ principalId: 'me' })]) as never, audit);
    const dto = await svc.create(
      { principalId: 'me', deputyId: 'deputy', scope: 'docflow' },
      user({}),
    );
    expect(dto.id).toBe('s1');
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'auth.substitution.created' }),
    );
  });

  it('lets an admin delegate anyone’s duties', async () => {
    const svc = new SubstitutionsService(makeDb([row({})]) as never, audit);
    const dto = await svc.create(
      { principalId: 'p1', deputyId: 'me', scope: 'docflow' },
      user({ permissions: ['admin.substitutions.manage'] }),
    );
    expect(dto.id).toBe('s1');
  });
});
