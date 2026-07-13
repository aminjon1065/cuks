import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from './auth.service';

const ctx = { ip: '127.0.0.1', userAgent: 'test' };

function makeService() {
  const users = {
    findActiveByUsername: vi.fn(),
    findActiveById: vi.fn(),
    setTotp: vi.fn().mockResolvedValue(undefined),
    markLoggedIn: vi.fn().mockResolvedValue(undefined),
  };
  const passwords = { verify: vi.fn(), verifyDummy: vi.fn().mockResolvedValue(undefined) };
  const sessions = {
    create: vi.fn().mockResolvedValue({ sessionId: 's', csrfToken: 'c', ttlSeconds: 100 }),
  };
  const lockout = {
    isRateLimited: vi.fn().mockResolvedValue(false),
    isLocked: vi.fn().mockResolvedValue(false),
    recordFailure: vi.fn().mockResolvedValue(undefined),
    reset: vi.fn().mockResolvedValue(undefined),
  };
  const totp = {
    verify: vi.fn(),
    consumeBackupCode: vi.fn(),
    generateSecret: vi.fn().mockReturnValue('NEWSECRET'),
    keyUri: vi.fn().mockReturnValue('otpauth://totp/CUKS:admin?secret=NEWSECRET'),
  };
  const crypto = {
    decrypt: vi.fn().mockReturnValue('SECRET'),
    encrypt: vi.fn().mockReturnValue('enc'),
  };
  const audit = { log: vi.fn() };
  const notifications = { notify: vi.fn().mockResolvedValue(undefined) };
  const service = new AuthService(
    users as never,
    passwords as never,
    sessions as never,
    lockout as never,
    totp as never,
    crypto as never,
    audit as never,
    notifications as never,
  );
  return { service, users, passwords, sessions, lockout, totp, crypto };
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

  it('reveals a blocked account only after a correct password', async () => {
    ctxObj.users.findActiveByUsername.mockResolvedValue({ ...activeUser, status: 'blocked' });
    ctxObj.passwords.verify.mockResolvedValue(true);
    await expect(
      ctxObj.service.login({ username: 'a', password: 'b', remember: false }, ctx),
    ).rejects.toMatchObject({ code: 'auth.login.blocked' });
  });

  it('runs a dummy verify for an unknown user (anti-enumeration)', async () => {
    ctxObj.users.findActiveByUsername.mockResolvedValue(undefined);
    await expect(
      ctxObj.service.login({ username: 'ghost', password: 'b', remember: false }, ctx),
    ).rejects.toMatchObject({ code: 'auth.login.invalid_credentials' });
    expect(ctxObj.passwords.verifyDummy).toHaveBeenCalledWith('b');
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

describe('AuthService.setupTotp', () => {
  let c: ReturnType<typeof makeService>;
  beforeEach(() => {
    c = makeService();
  });

  const pendingUser = { id: 'u1', username: 'admin', totpEnabled: false } as never;

  it('reuses a pending secret so repeated setup calls stay in sync', async () => {
    c.users.findActiveById.mockResolvedValue({ id: 'u1', totpSecret: 'enc-existing' });
    c.crypto.decrypt.mockReturnValue('EXISTING');
    const res = await c.service.setupTotp(pendingUser);
    expect(res.secret).toBe('EXISTING');
    expect(c.totp.generateSecret).not.toHaveBeenCalled();
    expect(c.users.setTotp).not.toHaveBeenCalled();
  });

  it('generates and stores a fresh secret when none is pending', async () => {
    c.users.findActiveById.mockResolvedValue({ id: 'u1', totpSecret: null });
    const res = await c.service.setupTotp(pendingUser);
    expect(res.secret).toBe('NEWSECRET');
    expect(c.users.setTotp).toHaveBeenCalledWith('u1', 'enc', false);
  });

  it('refuses when 2FA is already enabled', async () => {
    await expect(
      c.service.setupTotp({ id: 'u1', username: 'admin', totpEnabled: true } as never),
    ).rejects.toMatchObject({ code: 'auth.totp.already_enabled' });
  });
});
