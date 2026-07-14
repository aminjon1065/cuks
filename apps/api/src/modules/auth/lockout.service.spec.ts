import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LockoutService } from './lockout.service';

function makeRedis() {
  return {
    mget: vi.fn().mockResolvedValue([null, null]),
    incr: vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1),
    del: vi.fn().mockResolvedValue(1),
  };
}

function makeConfig(maxAttempts: number, windowSeconds = 900) {
  return {
    get: vi.fn((key: string) =>
      key === 'AUTH_LOCKOUT_MAX_ATTEMPTS' ? maxAttempts : windowSeconds,
    ),
  };
}

describe('LockoutService', () => {
  let redis: ReturnType<typeof makeRedis>;

  beforeEach(() => {
    redis = makeRedis();
  });

  it('locks once a counter reaches the configured max', async () => {
    redis.mget.mockResolvedValue(['5', '1']);
    const svc = new LockoutService(redis as never, makeConfig(5) as never);
    expect(await svc.isLocked('user', '1.2.3.4')).toBe(true);
  });

  it('does not lock while counters are below max', async () => {
    redis.mget.mockResolvedValue(['4', '2']);
    const svc = new LockoutService(redis as never, makeConfig(5) as never);
    expect(await svc.isLocked('user', '1.2.3.4')).toBe(false);
  });

  it('records a failure per username and per ip, with a window TTL on first hit', async () => {
    redis.incr.mockResolvedValue(1);
    const svc = new LockoutService(redis as never, makeConfig(5, 900) as never);
    await svc.recordFailure('user', '1.2.3.4');
    expect(redis.incr).toHaveBeenCalledTimes(2);
    expect(redis.expire).toHaveBeenCalledWith('lockout:user:user', 900);
    expect(redis.expire).toHaveBeenCalledWith('lockout:ip:1.2.3.4', 900);
  });

  it('is a no-op when disabled (max=0): never locks, never counts', async () => {
    const svc = new LockoutService(redis as never, makeConfig(0) as never);
    expect(await svc.isLocked('user', '1.2.3.4')).toBe(false);
    await svc.recordFailure('user', '1.2.3.4');
    expect(redis.mget).not.toHaveBeenCalled();
    expect(redis.incr).not.toHaveBeenCalled();
  });

  it('reset clears both keys (works even when disabled)', async () => {
    const svc = new LockoutService(redis as never, makeConfig(0) as never);
    await svc.reset('user', '1.2.3.4');
    expect(redis.del).toHaveBeenCalledWith('lockout:user:user', 'lockout:ip:1.2.3.4');
  });
});
