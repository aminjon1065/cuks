import { describe, expect, it } from 'vitest';
import {
  JOB_RUN_TTL_COVERS_STALENESS,
  JOB_RUN_TTL_SECONDS,
  JOB_STALE_AFTER_HOURS,
  METERED_JOBS,
  decodeJobRun,
  encodeJobRun,
  jobRunHealth,
  jobRunKey,
  type JobRunRecord,
} from './index';

const RUN: JobRunRecord = {
  finishedAt: '2026-08-02T03:00:12.000Z',
  durationMs: 1234,
  ok: true,
  counts: { emitted: 7, scanned: 42 },
  error: null,
};

describe('job run records', () => {
  it('round-trips', () => {
    expect(decodeJobRun(encodeJobRun(RUN))).toEqual(RUN);
  });

  it('keys one job per key, namespaced away from the error buckets', () => {
    for (const job of METERED_JOBS) expect(jobRunKey(job)).toBe(`metrics:jobrun:${job}`);
    // `metrics:errors:*` is the existing rolling-error bucket space (MetricsService). Neither
    // reader scans by prefix — both build their exact keys and MGET — so a collision would not
    // merely mix results, it would have one writer overwrite the other's value.
    expect(jobRunKey('deadlines').startsWith('metrics:errors')).toBe(false);
  });

  it('degrades to null on anything that is not a record', () => {
    // This feeds the health screen. A truncated write or an older format must read as «нет
    // данных», not throw and take the dashboard down.
    expect(decodeJobRun(null)).toBeNull();
    expect(decodeJobRun('')).toBeNull();
    expect(decodeJobRun('not json')).toBeNull();
    expect(decodeJobRun('"a string"')).toBeNull();
    expect(decodeJobRun('null')).toBeNull();
    expect(decodeJobRun(JSON.stringify({ ...RUN, finishedAt: 'yesterday' }))).toBeNull();
    expect(decodeJobRun(JSON.stringify({ ...RUN, durationMs: -1 }))).toBeNull();
    expect(decodeJobRun(JSON.stringify({ ...RUN, durationMs: 'fast' }))).toBeNull();
    expect(decodeJobRun(JSON.stringify({ ...RUN, ok: 'yes' }))).toBeNull();
  });

  it('drops non-numeric counts rather than the whole record', () => {
    const decoded = decodeJobRun(
      JSON.stringify({ ...RUN, counts: { emitted: 3, note: 'many', broken: Number.NaN } }),
    );
    // NaN serialises to null through JSON, so it arrives as a non-number like `note`.
    expect(decoded?.counts).toEqual({ emitted: 3 });
  });
});

describe('job run health', () => {
  const now = new Date('2026-08-02T12:00:00.000Z');

  it('is unknown when nothing was ever recorded', () => {
    expect(jobRunHealth('deadlines', null, now)).toBe('unknown');
  });

  it('is failed when the run threw, however recent', () => {
    expect(
      jobRunHealth(
        'deadlines',
        { ...RUN, ok: false, error: 'boom', finishedAt: now.toISOString() },
        now,
      ),
    ).toBe('failed');
  });

  it('is ok inside the job’s own window and stale past it', () => {
    const hoursAgo = (h: number): JobRunRecord => ({
      ...RUN,
      finishedAt: new Date(now.getTime() - h * 3_600_000).toISOString(),
    });
    expect(jobRunHealth('deadlines', hoursAgo(25), now)).toBe('ok');
    expect(jobRunHealth('deadlines', hoursAgo(27), now)).toBe('stale');
  });

  it('does not call the monthly job stale for being silent all month', () => {
    // `audit-maintenance` runs `0 3 1 * *`. Under one shared daily threshold it would be red
    // twenty-nine days out of thirty, which is the fastest way to teach people to ignore the
    // screen.
    const thirtyDays: JobRunRecord = {
      ...RUN,
      finishedAt: new Date(now.getTime() - 30 * 24 * 3_600_000).toISOString(),
    };
    expect(jobRunHealth('audit-maintenance', thirtyDays, now)).toBe('ok');
    expect(jobRunHealth('deadlines', thirtyDays, now)).toBe('stale');
    expect(JOB_STALE_AFTER_HOURS['audit-maintenance']).toBeGreaterThan(
      JOB_STALE_AFTER_HOURS.deadlines,
    );
  });

  it('keeps every record alive long enough to be seen going stale', () => {
    // The hole this closes: with a TTL shorter than a job's staleness threshold, the record
    // expires while the job is still «ok», so the state jumps ok → unknown and never passes
    // through stale. And `unknown` is what a fresh installation looks like — so a monthly job
    // that died would sit under the same benign label as one that has never had its first run.
    expect(JOB_RUN_TTL_COVERS_STALENESS).toBe(true);
    for (const job of METERED_JOBS) {
      expect(JOB_RUN_TTL_SECONDS, `${job} expires before it can go stale`).toBeGreaterThan(
        JOB_STALE_AFTER_HOURS[job] * 3600,
      );
    }
  });

  it('every metered job has a staleness threshold', () => {
    // Guards the map against a job added to METERED_JOBS and forgotten here, which would make
    // `jobRunHealth` compare against undefined and report everything as ok.
    for (const job of METERED_JOBS) expect(typeof JOB_STALE_AFTER_HOURS[job]).toBe('number');
  });
});
