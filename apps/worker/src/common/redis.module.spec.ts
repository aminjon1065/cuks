import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { REDIS_QUIT_TIMEOUT_MS, RedisModule } from './redis.module';

/** A fake ioredis exposing only what shutdown uses. */
function makeRedis(quit: () => Promise<unknown>) {
  return { quit: vi.fn(quit), disconnect: vi.fn() };
}

describe('RedisModule shutdown', () => {
  beforeEach(() => {
    // The fallback path logs a warning; keep the test output about the tests.
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('closes the client gracefully when Redis answers', async () => {
    const redis = makeRedis(() => Promise.resolve('OK'));

    await expect(new RedisModule(redis as never).onModuleDestroy()).resolves.toBeUndefined();

    expect(redis.quit).toHaveBeenCalledTimes(1);
    expect(redis.disconnect, 'no need to force what closed cleanly').not.toHaveBeenCalled();
  });

  it('falls back to disconnect when quit rejects', async () => {
    const redis = makeRedis(() => Promise.reject(new Error('Connection is closed.')));

    // main.ts awaits app.close() before process.exit(0): a rejection here would leave the
    // worker alive until the container's SIGKILL.
    await expect(new RedisModule(redis as never).onModuleDestroy()).resolves.toBeUndefined();

    expect(redis.disconnect).toHaveBeenCalledTimes(1);
  });

  it('does not wait forever when quit never settles', async () => {
    // What an unreachable Redis actually looks like: ioredis queues QUIT while it reconnects.
    const redis = makeRedis(() => new Promise(() => undefined));
    vi.useFakeTimers();

    const closed = new RedisModule(redis as never).onModuleDestroy();
    await vi.advanceTimersByTimeAsync(REDIS_QUIT_TIMEOUT_MS + 1);

    await expect(closed).resolves.toBeUndefined();
    expect(redis.disconnect).toHaveBeenCalledTimes(1);
  });

  it('still resolves when even disconnect throws', async () => {
    const redis = makeRedis(() => Promise.reject(new Error('Connection is closed.')));
    redis.disconnect.mockImplementation(() => {
      throw new Error('client destroyed');
    });

    await expect(new RedisModule(redis as never).onModuleDestroy()).resolves.toBeUndefined();
  });
});
