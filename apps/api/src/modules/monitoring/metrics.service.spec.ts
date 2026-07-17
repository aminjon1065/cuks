import { describe, expect, it, vi } from 'vitest';
import { MetricsService } from './metrics.service';

function redisMock(store: Record<string, string> = {}) {
  const exec = vi.fn().mockResolvedValue([]);
  const multi = {
    incr: vi.fn().mockReturnThis(),
    expire: vi.fn().mockReturnThis(),
    exec,
  };
  return {
    multi: vi.fn(() => multi),
    mget: vi.fn((...keys: string[]) => Promise.resolve(keys.map((k) => store[k] ?? null))),
    _multi: multi,
  };
}

const at = (iso: string) => new Date(iso);

describe('MetricsService.recordError', () => {
  it('increments the current UTC hour bucket with a TTL', () => {
    const redis = redisMock();
    const svc = new MetricsService(redis as never);
    svc.recordError(at('2026-07-17T01:23:45Z'));
    expect(redis.multi).toHaveBeenCalledOnce();
    expect(redis._multi.incr).toHaveBeenCalledWith('metrics:errors:2026-07-17T01');
    expect(redis._multi.expire).toHaveBeenCalledWith('metrics:errors:2026-07-17T01', 25 * 60 * 60);
  });

  it('never throws even if the redis pipeline rejects', () => {
    const redis = redisMock();
    redis._multi.exec.mockRejectedValueOnce(new Error('redis down'));
    const svc = new MetricsService(redis as never);
    expect(() => svc.recordError()).not.toThrow();
  });
});

describe('MetricsService.errorsLast24h', () => {
  it('sums the last 24 hourly buckets', async () => {
    const redis = redisMock({
      'metrics:errors:2026-07-17T01': '3',
      'metrics:errors:2026-07-17T00': '2',
      'metrics:errors:2026-07-16T02': '5', // exactly 23h earlier — still in window
    });
    const svc = new MetricsService(redis as never);
    const total = await svc.errorsLast24h(at('2026-07-17T01:59:00Z'));
    expect(total).toBe(10);
    expect(redis.mget).toHaveBeenCalledOnce();
    expect(redis.mget.mock.calls[0]).toHaveLength(24); // 24 hourly keys
  });

  it('returns 0 when redis is unavailable', async () => {
    const redis = redisMock();
    redis.mget.mockRejectedValueOnce(new Error('redis down'));
    const svc = new MetricsService(redis as never);
    await expect(svc.errorsLast24h()).resolves.toBe(0);
  });
});
