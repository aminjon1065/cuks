import { describe, expect, it, vi } from 'vitest';
import { METERED_JOBS, encodeJobRun, jobRunKey, type JobRunRecord } from '@cuks/shared';
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

  it('gives up on a read that never settles', async () => {
    await expect(neverSettles((svc) => svc.errorsLast24h())).resolves.toBe(0);
  });
});

/**
 * Drive one read against a client that accepts the command and never answers — a Redis that is
 * connected but unresponsive, or one holding the command in ioredis' offline queue. Rejecting is
 * the easy case (covered above); this is the one a bare try/catch does not cover, and it is the
 * one that would hang `GET /admin/health`.
 */
async function neverSettles<T>(read: (svc: MetricsService) => Promise<T>): Promise<T> {
  vi.useFakeTimers();
  try {
    const redis = redisMock();
    redis.mget.mockReturnValueOnce(new Promise<never>(() => undefined));
    const pending = read(new MetricsService(redis as never));
    await vi.advanceTimersByTimeAsync(2_500);
    return await pending;
  } finally {
    vi.useRealTimers();
  }
}

describe('MetricsService.jobRuns', () => {
  const run: JobRunRecord = {
    finishedAt: '2026-08-02T03:00:12.000Z',
    durationMs: 1234,
    ok: true,
    counts: { purged: 7 },
    error: null,
  };

  it('reads one key per metered job in a single mget', async () => {
    const redis = redisMock({ [jobRunKey('retention')]: encodeJobRun(run) });
    const svc = new MetricsService(redis as never);
    const runs = await svc.jobRuns();
    expect(redis.mget).toHaveBeenCalledOnce();
    expect(redis.mget.mock.calls[0]).toEqual(METERED_JOBS.map((j) => jobRunKey(j)));
    expect(runs.retention).toEqual(run);
    expect(runs.deadlines).toBeNull();
    expect(runs['audit-maintenance']).toBeNull();
  });

  it('reads a malformed value as "nothing recorded" instead of throwing', async () => {
    const redis = redisMock({ [jobRunKey('deadlines')]: '{"durationMs":' });
    const svc = new MetricsService(redis as never);
    await expect(svc.jobRuns()).resolves.toMatchObject({ deadlines: null });
  });

  it('hands back the stored error text unbounded — the cap belongs to the row builder', async () => {
    // The shared decoder validates shape, not length, so nothing between redis and the response
    // shortens this; `jobStatuses` is the single place that does. Pinned here so the seam is not
    // mistaken for one that already protects itself.
    const failed: JobRunRecord = { ...run, ok: false, error: 'e'.repeat(9_000) };
    const redis = redisMock({ [jobRunKey('deadlines')]: encodeJobRun(failed) });
    const svc = new MetricsService(redis as never);
    const runs = await svc.jobRuns();
    expect(runs.deadlines?.error).toHaveLength(9_000);
  });

  it('degrades to nothing recorded when redis is unavailable', async () => {
    // Same contract as errorsLast24h: the health screen still renders when redis is the outage.
    const redis = redisMock();
    redis.mget.mockRejectedValueOnce(new Error('redis down'));
    const svc = new MetricsService(redis as never);
    const runs = await svc.jobRuns();
    for (const job of METERED_JOBS) expect(runs[job]).toBeNull();
  });

  it('degrades to nothing recorded when the read never settles', async () => {
    // The overview awaits this inside a Promise.all; an unbounded wait here is the outage taking
    // the whole dashboard with it, which is exactly what the screen exists to survive.
    const runs = await neverSettles((svc) => svc.jobRuns());
    for (const job of METERED_JOBS) expect(runs[job]).toBeNull();
  });
});
