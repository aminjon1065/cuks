import { describe, expect, it } from 'vitest';
import {
  JOB_RUN_TTL_COVERS_STALENESS,
  JOB_RUN_TTL_SECONDS,
  JOB_STALE_AFTER_HOURS,
  METERED_JOBS,
  type JobRunRecord,
  type MeteredJob,
  type ServiceStatus,
} from '@cuks/shared';
import { aggregate, jobStatuses, withJobs } from './admin-health.service';

const up = (key: string): ServiceStatus => ({ key: key as never, state: 'up' });
const down = (key: string): ServiceStatus => ({ key: key as never, state: 'down' });
const notConfigured = (key: string): ServiceStatus => ({
  key: key as never,
  state: 'down',
  note: 'not-configured',
});

describe('aggregate (overall platform status)', () => {
  it('is ok when every configured service is up', () => {
    expect(aggregate([up('postgres'), up('redis'), notConfigured('livekit')])).toBe('ok');
  });

  it('ignores not-configured services (they are not failures)', () => {
    // Only configured services are up -> ok, despite a not-configured one being state:down.
    expect(aggregate([up('postgres'), notConfigured('geoserver')])).toBe('ok');
  });

  it('is degraded when some (but not all) configured services are down', () => {
    expect(aggregate([up('postgres'), down('redis'), up('minio')])).toBe('degraded');
  });

  it('is down when every configured service is down', () => {
    expect(aggregate([down('postgres'), down('redis'), notConfigured('martin')])).toBe('down');
  });

  it('is ok when nothing is configured', () => {
    expect(aggregate([notConfigured('livekit'), notConfigured('geoserver')])).toBe('ok');
  });
});

// --- Scheduled sweeps on the overview (plan этап 4 «метрики длительности/ошибок») ---

const NOW = new Date('2026-08-02T12:00:00.000Z');

const hoursAgo = (h: number, patch: Partial<JobRunRecord> = {}): JobRunRecord => ({
  finishedAt: new Date(NOW.getTime() - h * 3_600_000).toISOString(),
  durationMs: 4200,
  ok: true,
  counts: { emitted: 3 },
  error: null,
  ...patch,
});

const noRuns = (): Record<MeteredJob, JobRunRecord | null> => ({
  deadlines: null,
  retention: null,
  'audit-maintenance': null,
});

describe('jobStatuses', () => {
  it('returns one row per metered job, in contract order', () => {
    const rows = jobStatuses(noRuns(), NOW);
    expect(rows.map((r) => r.job)).toEqual([...METERED_JOBS]);
  });

  it('reports a job that never ran as unknown with null fields, not as a missing row', () => {
    const [deadlines] = jobStatuses(noRuns(), NOW);
    expect(deadlines).toEqual({
      job: 'deadlines',
      health: 'unknown',
      ran: false,
      finishedAt: null,
      durationMs: null,
      ok: null,
      counts: null,
      error: null,
    });
  });

  it('flattens a recorded run and classifies it with the job’s own threshold', () => {
    const rows = jobStatuses(
      {
        deadlines: hoursAgo(4, { counts: { scanned: 120, emitted: 5 } }),
        retention: hoursAgo(40),
        'audit-maintenance': hoursAgo(24 * 30),
      },
      NOW,
    );
    expect(rows[0]).toMatchObject({
      job: 'deadlines',
      health: 'ok',
      ran: true,
      durationMs: 4200,
      counts: { scanned: 120, emitted: 5 },
      error: null,
    });
    expect(rows[1]).toMatchObject({ job: 'retention', health: 'stale', ran: true });
    // Monthly sweep, silent for thirty days on purpose — not stale.
    expect(rows[2]).toMatchObject({ job: 'audit-maintenance', health: 'ok', ran: true });
  });

  it('carries the error message of a failed run', () => {
    const rows = jobStatuses(
      { ...noRuns(), deadlines: hoursAgo(1, { ok: false, error: 'boom' }) },
      NOW,
    );
    expect(rows[0]).toMatchObject({ health: 'failed', ok: false, error: 'boom' });
  });

  it('bounds an error message longer than the cap, whoever stored it', () => {
    // Records written before the writer capped its own output stay readable for the whole TTL
    // window, so the reader may not assume a bound it did not apply itself.
    const rows = jobStatuses(
      { ...noRuns(), retention: hoursAgo(1, { ok: false, error: 'x'.repeat(50_000) }) },
      NOW,
    );
    expect(rows[1]?.error).toHaveLength(2_000);
    // A message at or under the cap is handed through whole — this backstop is wider than the
    // worker's own 500-char cap, so nothing the current writer stores is cut a second time here.
    const short = jobStatuses(
      { ...noRuns(), retention: hoursAgo(1, { ok: false, error: 'y'.repeat(2_000) }) },
      NOW,
    )[1];
    expect(short?.error).toBe('y'.repeat(2_000));
    const fromWorker = jobStatuses(
      { ...noRuns(), retention: hoursAgo(1, { ok: false, error: 'z'.repeat(500) }) },
      NOW,
    )[1];
    expect(fromWorker?.error).toBe('z'.repeat(500));
  });

  it('does not cut a surrogate pair straddling the cap', () => {
    // 1999 chars then a 2-unit emoji: a plain slice would leave a lone high surrogate that
    // mangles to U+FFFD when the response is UTF-8 encoded.
    const rows = jobStatuses(
      { ...noRuns(), retention: hoursAgo(1, { ok: false, error: `${'z'.repeat(1_999)}😀tail` }) },
      NOW,
    );
    expect(rows[1]?.error).toBe('z'.repeat(1_999));
  });

  it('leaves a successful run without an error', () => {
    const rows = jobStatuses({ ...noRuns(), deadlines: hoursAgo(1) }, NOW);
    expect(rows[0]?.error).toBeNull();
  });
});

describe('withJobs (sweeps folded into the overall status)', () => {
  const rowsFor = (runs: Partial<Record<MeteredJob, JobRunRecord | null>>) =>
    jobStatuses({ ...noRuns(), ...runs }, NOW);

  it('leaves the status alone when every sweep is healthy', () => {
    expect(withJobs('ok', rowsFor({ deadlines: hoursAgo(4), retention: hoursAgo(9) }))).toBe('ok');
  });

  it('degrades on a failed sweep', () => {
    expect(withJobs('ok', rowsFor({ deadlines: hoursAgo(1, { ok: false, error: 'boom' }) }))).toBe(
      'degraded',
    );
  });

  it('degrades on a sweep that is overdue against its own schedule', () => {
    expect(withJobs('ok', rowsFor({ retention: hoursAgo(48) }))).toBe('degraded');
  });

  it('does not degrade when nothing was ever recorded', () => {
    // A fresh install before the first nightly run, or a flushed/unreachable redis — in the last
    // case the redis probe is already red. A permanently yellow new installation teaches people
    // to ignore the colour.
    expect(withJobs('ok', jobStatuses(noRuns(), NOW))).toBe('ok');
  });

  it('is only allowed to ignore unknown while the record outlives the staleness threshold', () => {
    // The rule above is safe because a sweep that stops running is still holding its record when
    // it crosses its own deadline: it degrades as `stale` instead of expiring back into the
    // benign `unknown`. Shorten the TTL past a threshold and that inverts silently, so this is
    // asserted here, at the reader whose behaviour depends on it — not only in @cuks/shared.
    expect(JOB_RUN_TTL_COVERS_STALENESS).toBe(true);
    const longestStaleHours = Math.max(...METERED_JOBS.map((j) => JOB_STALE_AFTER_HOURS[j]));
    expect(JOB_RUN_TTL_SECONDS).toBeGreaterThan(longestStaleHours * 3_600);
    // What the invariant buys is the ORDER (ok -> stale -> unknown), not permanence: the row is
    // stale only until the key expires, and that window is the TTL minus the job's own threshold.
    // Pinned so the margin cannot shrink to hours while the assertion above still passes.
    const staleWindowDays = (job: MeteredJob) =>
      (JOB_RUN_TTL_SECONDS - JOB_STALE_AFTER_HOURS[job] * 3_600) / 86_400;
    expect(staleWindowDays('audit-maintenance')).toBe(12);
    expect(staleWindowDays('deadlines')).toBeGreaterThan(40);
    expect(staleWindowDays('retention')).toBeGreaterThan(40);
  });

  it('degrades the monthly sweep once it is overdue by its own threshold', () => {
    // 33 days is the deadline; the record is still in redis to say so (45-day TTL).
    expect(withJobs('ok', rowsFor({ 'audit-maintenance': hoursAgo(24 * 34) }))).toBe('degraded');
  });

  it('does not degrade the monthly sweep for being between runs', () => {
    expect(withJobs('ok', rowsFor({ 'audit-maintenance': hoursAgo(24 * 30) }))).toBe('ok');
  });

  it('never lifts or lowers past degraded: down stays down', () => {
    expect(withJobs('down', rowsFor({ deadlines: hoursAgo(4) }))).toBe('down');
    expect(withJobs('down', rowsFor({ retention: hoursAgo(48) }))).toBe('down');
  });
});
