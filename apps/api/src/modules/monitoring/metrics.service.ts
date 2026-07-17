import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS } from '../../common/redis/redis.module';

/** 25h so a full 24h window is always covered after the current hour rolls over. */
const BUCKET_TTL_SECONDS = 25 * 60 * 60;
const WINDOW_HOURS = 24;

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
      const values = await this.redis.mget(...keys);
      return values.reduce((sum, v) => sum + (v ? Number.parseInt(v, 10) || 0 : 0), 0);
    } catch {
      return 0;
    }
  }
}
