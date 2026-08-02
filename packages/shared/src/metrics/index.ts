/**
 * Background-job run metrics (plan этап 4 «метрики длительности/ошибок», §14 «Метрики»).
 *
 * The scheduled sweeps run unattended in the worker and, until now, said nothing an operator
 * could act on: a run that took forty minutes and a run that never happened produced the same
 * evidence — one log line, or none, in a log nobody is watching. Queue depth and failed-job
 * counts (already on the health screen) do not cover this, because a repeatable job that throws
 * is retried and cleared, and one that quietly scans zero rows never fails at all.
 *
 * The contract lives here, in a package both processes import, for the same reason the DB pool
 * and the S3 client are duplicated rather than cross-imported: the WORKER writes these records
 * and the API reads them, and the two must not drift on the key layout. This module is pure —
 * no Redis, no Nest — so the writer and the reader can be thin.
 */

/** Jobs whose runs are recorded. A closed list: an unknown name would sit in Redis unread. */
export const METERED_JOBS = ['deadlines', 'retention', 'audit-maintenance'] as const;
export type MeteredJob = (typeof METERED_JOBS)[number];

/** What one finished run is worth remembering. */
export interface JobRunRecord {
  /** ISO instant the run finished. */
  finishedAt: string;
  /** Wall-clock duration of the whole sweep. */
  durationMs: number;
  /** False when the processor threw — the job may still have been retried afterwards. */
  ok: boolean;
  /**
   * What the run actually did, in the sweep's own units (`emitted`, `marked`, `purged`, …).
   * Free-form on purpose: a shared schema over three unrelated sweeps would be a lie by the
   * fourth one. Values are counts.
   */
  counts: Record<string, number>;
  /** Message of the error that ended the run; null when it succeeded. */
  error: string | null;
}

/** The last recorded run of each job, newest state only — this is a dashboard, not a history. */
export type JobRunSummary = { job: MeteredJob } & (
  | ({ ran: true } & JobRunRecord)
  | { ran: false; finishedAt: null; durationMs: null; ok: null; counts: null; error: null }
);

/** Redis key holding the last run of `job`. One key per job, overwritten each run. */
export function jobRunKey(job: MeteredJob): string {
  return `metrics:jobrun:${job}`;
}

/**
 * How long a record outlives its run.
 *
 * **It must outlive the longest staleness threshold below, and that is the whole rule.** A record
 * that expires first takes the job from `ok` straight to `unknown`, skipping `stale` — and
 * `unknown` reads as «ещё ни разу не запускалась», which is what a fresh installation looks like.
 * A monthly job that died would then sit under the same benign label as one that has simply never
 * had its first run, forever. The first version of this file had an 8-day TTL against a 33-day
 * threshold and did exactly that.
 *
 * `JOB_RUN_TTL_COVERS_STALENESS` below is the assertion, kept next to the number.
 */
export const JOB_RUN_TTL_SECONDS = 45 * 24 * 60 * 60;

/** Serialise for Redis. Kept beside the parser so the two cannot drift. */
export function encodeJobRun(record: JobRunRecord): string {
  return JSON.stringify(record);
}

/**
 * Parse a stored record, tolerating anything that is not one.
 *
 * Returns null rather than throwing: this feeds a health screen, and a malformed key — an older
 * format, a truncated write, a hand-edited value — must degrade to «нет данных», not take the
 * dashboard down with it.
 */
export function decodeJobRun(raw: string | null | undefined): JobRunRecord | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const r = parsed as Partial<JobRunRecord>;
  if (typeof r.finishedAt !== 'string' || Number.isNaN(Date.parse(r.finishedAt))) return null;
  if (typeof r.durationMs !== 'number' || !Number.isFinite(r.durationMs) || r.durationMs < 0) {
    return null;
  }
  if (typeof r.ok !== 'boolean') return null;
  const counts: Record<string, number> = {};
  if (r.counts && typeof r.counts === 'object') {
    for (const [key, value] of Object.entries(r.counts)) {
      if (typeof value === 'number' && Number.isFinite(value)) counts[key] = value;
    }
  }
  return {
    finishedAt: r.finishedAt,
    durationMs: r.durationMs,
    ok: r.ok,
    counts,
    error: typeof r.error === 'string' ? r.error : null,
  };
}

/** The dashboard's verdict on one job. */
export type JobRunHealth = 'ok' | 'failed' | 'stale' | 'unknown';

/**
 * How overdue a job may be before its last run stops counting as evidence that it is alive.
 *
 * Per job, because the schedules differ by an order of magnitude: `deadlines` and `retention`
 * are daily, `audit-maintenance` is monthly (`0 3 1 * *`) and is SUPPOSED to be silent for four
 * weeks. One shared threshold would either cry wolf about the monthly job every day, or let the
 * daily ones sit dead for a month.
 */
export const JOB_STALE_AFTER_HOURS: Record<MeteredJob, number> = {
  deadlines: 26,
  retention: 26,
  'audit-maintenance': 24 * 33,
};

/**
 * True when every job's record survives long enough to be seen going stale.
 *
 * Exported rather than merely asserted in a test so the invariant is readable from the numbers
 * it constrains: raise a threshold past the TTL and this goes false.
 */
export const JOB_RUN_TTL_COVERS_STALENESS =
  JOB_RUN_TTL_SECONDS > Math.max(...Object.values(JOB_STALE_AFTER_HOURS)) * 3600;

/** Classify a job's last run. `unknown` means nothing was ever recorded (or Redis lost it). */
export function jobRunHealth(
  job: MeteredJob,
  record: JobRunRecord | null,
  now: Date = new Date(),
): JobRunHealth {
  if (!record) return 'unknown';
  if (!record.ok) return 'failed';
  const ageHours = (now.getTime() - Date.parse(record.finishedAt)) / 3_600_000;
  return ageHours > JOB_STALE_AFTER_HOURS[job] ? 'stale' : 'ok';
}
