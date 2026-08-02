import { describe, expect, it, vi } from 'vitest';
import { JOB_RUN_TTL_SECONDS, decodeJobRun, jobRunKey } from '@cuks/shared';
import { JobMetricsService, MAX_ERROR_MESSAGE_LENGTH } from './job-metrics.service';

/** A fake Redis exposing only what the service uses: `set key value EX ttl`. */
function makeRedis() {
  const set = vi.fn().mockResolvedValue('OK');
  return { set };
}

/** The record the service wrote, decoded through the shared parser. */
function written(redis: ReturnType<typeof makeRedis>) {
  const call = redis.set.mock.calls.at(-1);
  expect(call, 'a record was written').toBeTruthy();
  return {
    key: call![0] as string,
    record: decodeJobRun(call![1] as string),
    args: call!.slice(2),
  };
}

describe('JobMetricsService', () => {
  it('records a successful run with its counts, under the job key with a TTL', async () => {
    const redis = makeRedis();
    const service = new JobMetricsService(redis as never);

    await service.record('deadlines', Date.now() - 1_500, {
      ok: true,
      counts: { scanned: 42, emitted: 7 },
    });

    const { key, record, args } = written(redis);
    expect(key).toBe(jobRunKey('deadlines'));
    expect(args).toEqual(['EX', JOB_RUN_TTL_SECONDS]);
    expect(record?.ok).toBe(true);
    expect(record?.counts).toEqual({ scanned: 42, emitted: 7 });
    expect(record?.error).toBeNull();
    expect(record?.durationMs).toBeGreaterThanOrEqual(1_500);
    expect(Date.parse(record!.finishedAt)).not.toBeNaN();
  });

  it('records a failed run with the error message and no counts', async () => {
    const redis = makeRedis();
    const service = new JobMetricsService(redis as never);

    await service.record('retention', Date.now(), {
      ok: false,
      error: new Error('connection terminated unexpectedly'),
    });

    const { record } = written(redis);
    expect(record?.ok).toBe(false);
    expect(record?.error).toBe('connection terminated unexpectedly');
    // A run that threw was interrupted: its partial tallies would read as a completed sweep.
    expect(record?.counts).toEqual({});
  });

  it('renders a non-Error throw readably rather than dropping the record', async () => {
    const redis = makeRedis();
    const service = new JobMetricsService(redis as never);

    await service.record('audit-maintenance', Date.now(), { ok: false, error: 'plain string' });

    expect(written(redis).record?.error).toBe('plain string');
  });

  it('bounds a runaway error message at the stored cap', async () => {
    const redis = makeRedis();
    const service = new JobMetricsService(redis as never);

    // A driver dumping the offending query, or a formatted stack: the api relays this verbatim
    // to a screen that refetches every 15 s.
    await service.record('retention', Date.now(), {
      ok: false,
      error: new Error('x'.repeat(MAX_ERROR_MESSAGE_LENGTH + 5_000)),
    });

    expect(written(redis).record?.error).toBe('x'.repeat(MAX_ERROR_MESSAGE_LENGTH));
  });

  it('still records — and still resolves — when the thrown value cannot be stringified', async () => {
    const redis = makeRedis();
    const service = new JobMetricsService(redis as never);

    // `String()` on a null-prototype object throws «Cannot convert object to primitive value».
    // Rendering it in front of the guard would reject `record()` on the failure path, and the
    // processor's catch block would hand BullMQ that TypeError instead of the real cause.
    await expect(
      service.record('deadlines', Date.now(), { ok: false, error: Object.create(null) as unknown }),
    ).resolves.toBeUndefined();

    const { record } = written(redis);
    expect(record?.ok).toBe(false);
    expect(record?.error).toBe('unstringifiable error');
  });

  it('survives a thrown value whose own `toString` throws', async () => {
    const redis = makeRedis();
    const service = new JobMetricsService(redis as never);
    const hostile = {
      toString() {
        throw new Error('nope');
      },
    };

    await expect(
      service.record('audit-maintenance', Date.now(), { ok: false, error: hostile }),
    ).resolves.toBeUndefined();

    expect(written(redis).record?.error).toBe('unstringifiable error');
  });

  it('swallows a Redis failure — bookkeeping must never fail the work it measures', async () => {
    const redis = makeRedis();
    redis.set.mockRejectedValueOnce(new Error('redis down'));
    const service = new JobMetricsService(redis as never);

    await expect(
      service.record('deadlines', Date.now(), { ok: true, counts: { emitted: 1 } }),
    ).resolves.toBeUndefined();
  });

  it('swallows a synchronous Redis throw too', async () => {
    const redis = makeRedis();
    redis.set.mockImplementationOnce(() => {
      throw new Error('client destroyed');
    });
    const service = new JobMetricsService(redis as never);

    await expect(
      service.record('retention', Date.now(), { ok: false, error: new Error('boom') }),
    ).resolves.toBeUndefined();
  });

  it('clamps a backwards clock so the record still decodes', async () => {
    const redis = makeRedis();
    const service = new JobMetricsService(redis as never);

    // startedAt in the future (a clock stepped back mid-run) — a negative duration would be
    // rejected by the shared decoder, losing the record over a cosmetic detail.
    await service.record('deadlines', Date.now() + 10_000, { ok: true, counts: {} });

    expect(written(redis).record?.durationMs).toBe(0);
  });
});
