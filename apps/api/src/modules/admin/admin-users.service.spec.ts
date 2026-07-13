import { beforeEach, describe, expect, it, vi } from 'vitest';
import { wsRooms } from '@cuks/shared';
import { AdminUsersService } from './admin-users.service';

function selectChain(result: unknown[]) {
  const obj: Record<string, unknown> = {};
  for (const m of ['from', 'where', 'orderBy', 'limit', 'offset', 'innerJoin', 'leftJoin']) {
    obj[m] = () => obj;
  }
  obj['then'] = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
    Promise.resolve(result).then(res, rej);
  return obj;
}

function make() {
  const db = {
    select: vi.fn(() => selectChain([])),
    insert: vi.fn(() => ({
      values: () => ({ returning: () => Promise.resolve([{ id: 'new' }]) }),
    })),
    update: vi.fn(() => ({ set: () => ({ where: () => Promise.resolve() }) })),
  };
  const passwords = { hash: vi.fn().mockResolvedValue('hashed') };
  const sessions = { revokeAll: vi.fn().mockResolvedValue(0) };
  const usersService = {
    findActiveById: vi.fn().mockResolvedValue({ id: 'u2', username: 'target' }),
    setPassword: vi.fn().mockResolvedValue(undefined),
    clearTotp: vi.fn().mockResolvedValue(undefined),
  };
  const realtime = { emitToRoom: vi.fn(), emitToUser: vi.fn() };
  const audit = { log: vi.fn() };
  const service = new AdminUsersService(
    db as never,
    passwords as never,
    sessions as never,
    usersService as never,
    realtime as never,
    audit as never,
  );
  return { service, db, passwords, sessions, usersService, realtime, audit };
}

const actor = { id: 'u1' } as never;

describe('AdminUsersService', () => {
  let c: ReturnType<typeof make>;
  beforeEach(() => {
    c = make();
  });

  it('creates a user with a generated username + temp password', async () => {
    const result = await c.service.create({ fullName: 'Иванов Пётр Сергеевич' }, actor);
    expect(result.username).toBe('ivanov.p');
    expect(result.tempPassword.length).toBeGreaterThanOrEqual(12);
    expect(c.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'admin.user.created', entityType: 'user' }),
    );
  });

  it('blocks a user, kills their sessions and pushes a forced logout', async () => {
    await c.service.block('u2', actor);
    expect(c.sessions.revokeAll).toHaveBeenCalledWith('u2');
    expect(c.realtime.emitToRoom).toHaveBeenCalledWith(wsRooms.user('u2'), 'auth.forced_logout', {
      reason: 'blocked',
    });
    expect(c.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'admin.user.blocked' }),
    );
  });

  it('refuses to block or delete yourself', async () => {
    await expect(c.service.block('u1', actor)).rejects.toMatchObject({
      code: 'admin.user.self_block',
    });
    await expect(c.service.remove('u1', actor)).rejects.toMatchObject({
      code: 'admin.user.self_delete',
    });
  });
});
