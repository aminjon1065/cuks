import { Global, Inject, Logger, Module, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import type { WorkerEnv } from '../config/env';
import { withTimeout } from './with-timeout';

/** Injection token for the worker's own ioredis client. */
export const REDIS = 'REDIS_CLIENT';

/**
 * How long shutdown waits for a graceful QUIT before dropping the socket.
 *
 * Short by design: nothing is lost by not saying goodbye to Redis, and the whole point is to be
 * well inside the container's SIGKILL grace period rather than anywhere near it.
 */
export const REDIS_QUIT_TIMEOUT_MS = 2_000;

/**
 * The worker's own Redis client, mirroring `apps/api/src/common/redis/redis.module.ts`.
 *
 * Duplicated rather than cross-imported from apps/api — the same precedent as the DB pool
 * (DbModule) and the S3 client (StorageModule): each app owns its infra client. BullMQ's own
 * connection is not reusable here, because it is owned by the queue runtime and must keep
 * `maxRetriesPerRequest: null`; plain commands (the job-run metric writes) get their own client
 * so a slow metric write can never sit in front of a job fetch.
 */
@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      useFactory: (config: ConfigService<WorkerEnv, true>): Redis => {
        const client = new Redis(config.get('REDIS_URL', { infer: true }));
        const logger = new Logger('Redis');
        // Prevent an unhandled 'error' event from crashing the worker when Redis is briefly
        // unavailable; ioredis reconnects on its own.
        client.on('error', (err: Error) => logger.error(`redis error: ${err.message}`));
        return client;
      },
      inject: [ConfigService],
    },
  ],
  exports: [REDIS],
})
export class RedisModule implements OnModuleDestroy {
  private readonly logger = new Logger('Redis');

  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  /**
   * Close the client on shutdown — but never let it hold the process hostage.
   *
   * `quit` sends a QUIT and waits for the reply. With Redis unreachable at SIGTERM, ioredis is
   * in its reconnect loop and the command is queued: the promise can reject, or simply never
   * settle. `main.ts` awaits `app.close()` before `process.exit(0)`, so either outcome would
   * leave the worker sitting there until the container's SIGKILL. Bound the wait and fall back
   * to `disconnect()`, which tears the socket down without a round-trip.
   */
  async onModuleDestroy(): Promise<void> {
    try {
      await withTimeout(this.redis.quit(), REDIS_QUIT_TIMEOUT_MS, 'redis quit timed out');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`redis quit failed (${message}); dropping the connection`);
      try {
        this.redis.disconnect();
      } catch {
        // A client that cannot even be disconnected is already gone; shutdown continues either
        // way — this handler exists so that it does.
      }
    }
  }
}
