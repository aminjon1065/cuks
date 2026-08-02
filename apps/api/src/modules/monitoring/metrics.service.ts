import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import {
  METERED_JOBS,
  decodeJobRun,
  jobRunKey,
  type JobRunRecord,
  type MeteredJob,
} from '@cuks/shared';
import { REDIS } from '../../common/redis/redis.module';

/** 25h so a full 24h window is always covered after the current hour rolls over. */
const BUCKET_TTL_SECONDS = 25 * 60 * 60;
const WINDOW_HOURS = 24;

/**
 * Bound on a single read, so a Redis outage cannot hang the admin health overview.
 *
 * Catching is not enough on its own: the shared client is built with ioredis' defaults, so a
 * command issued while Redis is unreachable goes into the offline queue and only rejects once the
 * retry budget runs out — and if the socket is up but the server has stopped answering, nothing
 * rejects it at all. Both reads below are awaited inside the overview's `Promise.all`, whose whole
 * purpose is to render WHILE the things it monitors are down, so an unbounded wait there is the
 * outage taking the dashboard with it. Same 2 s and same reason as `QueueStatsService`.
 */
const READ_TIMEOUT_MS = 2000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('redis read timeout')), ms).unref(),
    ),
  ]);
}

/**
 * Lightweight app metrics kept in Redis (task 7.3). Currently just a rolling 24h count of unexpected
 * (5xx) errors for the admin health dashboard — incremented by the global exception filter, summed
 * across hourly buckets. Redis (not the DB) so a burst of errors doesn't write-amplify Postgres, and
 * the buckets self-expire.
 */
@Injectable()
export class MetricsService {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  private bucketKey(d: Date): string {
    // UTC hour bucket, e.g. metrics:errors:2026-07-17T01.
    const iso = d.toISOString();
    return `metrics:errors:${iso.slice(0, 13)}`;
  }

  /** Fire-and-forget: never let metric bookkeeping fail a request path. */
  recordError(now: Date = new Date()): void {
    const key = this.bucketKey(now);
    this.redis
      .multi()
      .incr(key)
      .expire(key, BUCKET_TTL_SECONDS)
      .exec()
      .catch(() => undefined);
  }

  /** Sum of the last 24 hourly buckets (0 when Redis is unavailable). */
  async errorsLast24h(now: Date = new Date()): Promise<number> {
    const keys: string[] = [];
    for (let h = 0; h < WINDOW_HOURS; h += 1) {
      keys.push(this.bucketKey(new Date(now.getTime() - h * 60 * 60 * 1000)));
    }
    try {
      const values = await withTimeout(this.redis.mget(...keys), READ_TIMEOUT_MS);
      return values.reduce((sum, v) => sum + (v ? Number.parseInt(v, 10) || 0 : 0), 0);
    } catch {
      return 0;
    }
  }

  /**
   * Last recorded run of every metered scheduled sweep (plan этап 4 «метрики длительности/ошибок»).
   *
   * The worker writes `metrics:jobrun:*`, the api only reads it — one MGET, decoded through the
   * shared parser so a malformed or older-format value reads as «nothing recorded» instead of
   * throwing. Redis being unavailable degrades the same way, for the same reason `errorsLast24h`
   * returns 0: the health screen must still render when the thing it monitors is what is broken.
   * Bounded as well as caught, because «unavailable» includes not answering (see `withTimeout`).
   */
  async jobRuns(): Promise<Record<MeteredJob, JobRunRecord | null>> {
    const keys = METERED_JOBS.map((job) => jobRunKey(job));
    let values: (string | null)[] = [];
    try {
      values = await withTimeout(this.redis.mget(...keys), READ_TIMEOUT_MS);
    } catch {
      values = [];
    }
    const runs = {} as Record<MeteredJob, JobRunRecord | null>;
    METERED_JOBS.forEach((job, i) => {
      runs[job] = decodeJobRun(values[i]);
    });
    return runs;
  }
}
