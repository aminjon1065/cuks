import { Inject, Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import {
  JOB_RUN_TTL_SECONDS,
  encodeJobRun,
  jobRunKey,
  truncateSafe,
  type JobRunRecord,
  type MeteredJob,
} from '@cuks/shared';
import { REDIS } from './redis.module';

/**
 * How a sweep ended. Counts are only carried on the success path: a run that threw was
 * interrupted mid-way and its partial tallies would read as a completed sweep on the dashboard.
 */
export type JobRunOutcome =
  { ok: true; counts: Record<string, number> } | { ok: false; error: unknown };

/**
 * Longest error message kept with a run.
 *
 * Bounded here, at the write, because this is the only place the raw value is known, and because
 * the health screen refetches every 15 s: a driver that dumps the offending query — or a
 * formatted stack — would be re-transferred on every poll and would turn one job's row into a
 * wall of text. 500 characters is the same cap the docflow exchange module stores its failure
 * messages under, and it holds the part that names what broke.
 *
 * The api caps again on the way out, deliberately wider (2 000 chars, `cappedError` in
 * `admin-health.service.ts`), as a backstop over records this writer did not produce — one stored
 * before this cap existed outlives the change by up to `JOB_RUN_TTL_SECONDS`, and the two
 * processes roll independently. This 500 stays the effective bound for anything written now.
 */
export const MAX_ERROR_MESSAGE_LENGTH = 500;

/**
 * Whatever was thrown, as a bounded line an operator can read.
 *
 * Total on purpose. The value comes straight out of a `catch`, so it can be anything a `throw`
 * can carry: an object with a null prototype, a Proxy, an object whose `toString` throws — and
 * on those both `instanceof` and the string conversion can throw. Such a throw would escape
 * `record()` on the failure path and, inside the processor's catch block, replace the ORIGINAL
 * error before it is re-thrown, telling BullMQ the wrong cause. A placeholder is worth more.
 */
function errorMessage(error: unknown): string {
  try {
    const text = error instanceof Error && error.message ? error.message : String(error);
    return text.length > 0 ? truncateSafe(text, MAX_ERROR_MESSAGE_LENGTH) : 'unknown error';
  } catch {
    return 'unstringifiable error';
  }
}

/**
 * Writes the last run of each scheduled sweep to Redis (plan этап 4 «метрики длительности/
 * ошибок»). The api reads these back for the admin health screen; the key layout and encoding
 * live in `@cuks/shared` so writer and reader cannot drift.
 *
 * One key per job, overwritten each run, with a TTL — this is a dashboard, not a history.
 * Namespaced under `metrics:jobrun:*`, clear of the api's rolling `metrics:errors:*` buckets.
 */
@Injectable()
export class JobMetricsService {
  private readonly logger = new Logger(JobMetricsService.name);

  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  /**
   * Record one finished run. Never rejects, and never throws: the bookkeeping must not be able
   * to fail the work it measures — a sweep that purged its rows and then could not reach Redis
   * did its job, and reporting it as failed would be worse than reporting nothing. A write that
   * did not land degrades to «нет данных» on the health screen (or to the previous run's record
   * until its TTL runs out), which is the honest answer.
   */
  async record(job: MeteredJob, startedAt: number, outcome: JobRunOutcome): Promise<void> {
    try {
      // Building the record is guarded together with the write, not left in front of it:
      // `outcome.error` is a value someone else threw and is only as well-behaved as they made
      // it, so rendering it is no safer than reaching Redis.
      //
      // Clamped: a clock stepped backwards mid-run would otherwise produce a negative duration,
      // which the shared decoder rejects outright — losing the record over a cosmetic detail.
      const durationMs = Math.max(0, Date.now() - startedAt);
      const record: JobRunRecord = {
        finishedAt: new Date().toISOString(),
        durationMs,
        ok: outcome.ok,
        counts: outcome.ok ? outcome.counts : {},
        error: outcome.ok ? null : errorMessage(outcome.error),
      };
      await this.redis.set(jobRunKey(job), encodeJobRun(record), 'EX', JOB_RUN_TTL_SECONDS);
    } catch (err) {
      this.logger.warn({ err, job }, 'failed to record job run metrics');
    }
  }
}
