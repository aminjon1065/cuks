import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from './auth.service';

const ctx = { ip: '127.0.0.1', userAgent: 'test' };

function makeService() {
  const users = {
    findActiveByUsername: vi.fn(),
    markLoggedIn: vi.fn().mockResolvedValue(undefined),
  };
  const passwords = { verify: vi.fn() };
  const sessions = {
    create: vi.fn().mockResolvedValue({ sessionId: 's', csrfToken: 'c', ttlSeconds: 100 }),
  };
  const lockout = {
    isRateLimited: vi.fn().mockResolvedValue(false),
    isLocked: vi.fn().mockResolvedValue(false),
    recordFailure: vi.fn().mockResolvedValue(undefined),
    reset: vi.fn().mockResolvedValue(undefined),
  };
  const totp = { verify: vi.fn(), consumeBackupCode: vi.fn() };
  const crypto = { decrypt: vi.fn().mockReturnValue('SECRET') };
  const audit = { log: vi.fn() };
  const service = new AuthService(
    users as never,
    passwords as never,
    sessions as never,
    lockout as never,
    totp as never,
    crypto as never,
    audit as never,
  );
  return { service, users, passwords, sessions, lockout, totp };
}

const activeUser = {
  id: 'u1',
  username: 'admin',
  status: 'active' as const,
  passwordHash: 'hash',
  totpEnabled: false,
  mustChangePassword: true,
  totpSecret: null,
};

describe('AuthService.login', () => {
  let ctxObj: ReturnType<typeof makeService>;
  beforeEach(() => {
    ctxObj = makeService();
  });

  it('rejects when rate limited', async () => {
    ctxObj.lockout.isRateLimited.mockResolvedValue(true);
    await expect(
      ctxObj.service.login({ username: 'a', password: 'b', remember: false }, ctx),
    ).rejects.toMatchObject({ code: 'auth.login.rate_limited' });
  });

  it('rejects when locked out', async () => {
    ctxObj.lockout.isLocked.mockResolvedValue(true);
    await expect(
      ctxObj.service.login({ username: 'a', password: 'b', remember: false }, ctx),
    ).rejects.toMatchObject({ code: 'auth.login.locked' });
  });

  it('records a failure and returns generic error for an unknown user', async () => {
    ctxObj.users.findActiveByUsername.mockResolvedValue(undefined);
    await expect(
      ctxObj.service.login({ username: 'a', password: 'b', remember: false }, ctx),
    ).rejects.toMatchObject({ code: 'auth.login.invalid_credentials' });
    expect(ctxObj.lockout.recordFailure).toHaveBeenCalled();
  });

  it('rejects a blocked account', async () => {
    ctxObj.users.findActiveByUsername.mockResolvedValue({ ...activeUser, status: 'blocked' });
    await expect(
      ctxObj.service.login({ username: 'a', password: 'b', remember: false }, ctx),
    ).rejects.toMatchObject({ code: 'auth.login.blocked' });
  });

  it('rejects a wrong password with the generic error', async () => {
    ctxObj.users.findActiveByUsername.mockResolvedValue(activeUser);
    ctxObj.passwords.verify.mockResolvedValue(false);
    await expect(
      ctxObj.service.login({ username: 'a', password: 'b', remember: false }, ctx),
    ).rejects.toMatchObject({ code: 'auth.login.invalid_credentials' });
    expect(ctxObj.lockout.recordFailure).toHaveBeenCalled();
  });

  it('requires a TOTP code when 2FA is enabled', async () => {
    ctxObj.users.findActiveByUsername.mockResolvedValue({ ...activeUser, totpEnabled: true });
    ctxObj.passwords.verify.mockResolvedValue(true);
    await expect(
      ctxObj.service.login({ username: 'a', password: 'b', remember: false }, ctx),
    ).rejects.toMatchObject({ code: 'auth.login.totp_required' });
  });

  it('creates a session on success and resets the lockout', async () => {
    ctxObj.users.findActiveByUsername.mockResolvedValue(activeUser);
    ctxObj.passwords.verify.mockResolvedValue(true);
    const result = await ctxObj.service.login(
      { username: 'a', password: 'b', remember: false },
      ctx,
    );
    expect(result.session.sessionId).toBe('s');
    expect(result.mustChangePassword).toBe(true);
    expect(ctxObj.lockout.reset).toHaveBeenCalled();
    expect(ctxObj.users.markLoggedIn).toHaveBeenCalledWith('u1');
  });
});
