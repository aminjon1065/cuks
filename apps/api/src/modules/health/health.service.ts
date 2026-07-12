import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { checkDatabase, createDb, type DbHandle } from '@cuks/db';
import type { DependencyState, HealthState, LivenessResult, ReadinessResult } from '@cuks/shared';
import { ConfigService } from '../../config/config.service';

const PROBE_TIMEOUT_MS = 2000;

/** Health probes for liveness and dependency readiness (docs/01 §Health). */
@Injectable()
export class HealthService implements OnModuleDestroy {
  private readonly logger = new Logger(HealthService.name);
  private readonly dbHandle: DbHandle;
  private readonly redis: Redis;
  private readonly s3Endpoint: string;

  constructor(config: ConfigService) {
    // `statement_timeout` aborts a hung probe query server-side so its pooled
    // connection is released (a client-side race() alone cannot cancel it).
    this.dbHandle = createDb(
      config.get('DATABASE_URL'),
      { connectionTimeoutMillis: PROBE_TIMEOUT_MS, statement_timeout: PROBE_TIMEOUT_MS, max: 4 },
      (err) => this.logger.error(`postgres pool error: ${err.message}`),
    );
    // `commandTimeout` bounds a hung PING; the offline queue lets a single
    // lazy connect resolve without the connect/ping race of manual connect().
    this.redis = new Redis(config.get('REDIS_URL'), {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      commandTimeout: PROBE_TIMEOUT_MS,
      connectTimeout: PROBE_TIMEOUT_MS,
    });
    // Dedicated probe client: connection errors are expected when Redis is down;
    // readiness reports `redis: 'down'` instead of crashing on an unhandled event.
    this.redis.on('error', () => undefined);
    this.s3Endpoint = config.get('S3_ENDPOINT');
  }

  liveness(): LivenessResult {
    return { status: 'ok', uptimeSeconds: Math.floor(process.uptime()) };
  }

  async readiness(): Promise<ReadinessResult> {
    const [postgres, redis, minio] = await Promise.all([
      this.checkPostgres(),
      this.checkRedis(),
      this.checkMinio(),
    ]);
    const dependencies = { postgres, redis, minio };
    return { status: this.aggregate(dependencies), dependencies };
  }

  private aggregate(deps: Record<string, DependencyState>): HealthState {
    const states = Object.values(deps);
    if (states.every((s) => s === 'up')) return 'ok';
    if (states.every((s) => s === 'down')) return 'down';
    return 'degraded';
  }

  private async checkPostgres(): Promise<DependencyState> {
    try {
      await withTimeout(checkDatabase(this.dbHandle.db), PROBE_TIMEOUT_MS);
      return 'up';
    } catch {
      return 'down';
    }
  }

  private async checkRedis(): Promise<DependencyState> {
    try {
      // ioredis lazily connects on the first command; `commandTimeout` bounds it.
      const pong = await withTimeout(this.redis.ping(), PROBE_TIMEOUT_MS + 500);
      return pong === 'PONG' ? 'up' : 'down';
    } catch {
      return 'down';
    }
  }

  private async checkMinio(): Promise<DependencyState> {
    try {
      const res = await fetch(new URL('/minio/health/live', this.s3Endpoint), {
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });
      return res.ok ? 'up' : 'down';
    } catch {
      return 'down';
    }
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.allSettled([this.dbHandle.pool.end(), this.redis.quit()]);
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('probe timeout')), ms).unref(),
    ),
  ]);
}
