import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import { QUEUE, type QueueStats } from '@cuks/shared';
import { ConfigService } from '../../config/config.service';

/** Bound a queue read so a Redis outage can't hang the health dashboard. BullMQ's connection needs
 *  maxRetriesPerRequest: null (blocking ops), which with ioredis' offline queue means commands issued
 *  while Redis is down never reject — so we race every read against a timeout, like HealthService does. */
const QUEUE_READ_TIMEOUT_MS = 2000;
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('queue read timeout')), ms).unref(),
    ),
  ]);
}

/**
 * Read-only observability over every BullMQ queue for the admin health dashboard (docs/modules/16 §7).
 * Constructs its own lightweight Queue handles (not the DI-registered producer queues) so it can observe
 * ALL queues uniformly — including worker-only ones the api never produces to (preview, text-extract,
 * retention, …) — without duplicate-provider conflicts. Also retries failed jobs on operator request.
 */
@Injectable()
export class QueueStatsService implements OnModuleDestroy {
  private readonly logger = new Logger(QueueStatsService.name);
  private readonly queues = new Map<string, Queue>();

  constructor(config: ConfigService) {
    const url = config.get('REDIS_URL');
    for (const name of Object.values(QUEUE)) {
      // maxRetriesPerRequest: null is required by BullMQ's blocking connection.
      this.queues.set(name, new Queue(name, { connection: { url, maxRetriesPerRequest: null } }));
    }
  }

  /** All queues' counts. A single queue's failure degrades to zeros rather than failing the dashboard. */
  async stats(): Promise<QueueStats[]> {
    return Promise.all(
      [...this.queues.entries()].map(async ([name, queue]) => {
        try {
          const c = await withTimeout(
            queue.getJobCounts('waiting', 'active', 'failed', 'delayed', 'completed'),
            QUEUE_READ_TIMEOUT_MS,
          );
          return {
            name,
            waiting: c.waiting ?? 0,
            active: c.active ?? 0,
            failed: c.failed ?? 0,
            delayed: c.delayed ?? 0,
            completed: c.completed ?? 0,
          };
        } catch (err) {
          this.logger.warn({ err, queue: name }, 'queue counts unavailable');
          return { name, waiting: 0, active: 0, failed: 0, delayed: 0, completed: 0 };
        }
      }),
    );
  }

  /** Re-enqueue every failed job on one queue; returns how many were actually retried. Unknown queue ->
   *  null. allSettled (not all) so one job that can't be retried doesn't abort the rest after a partial
   *  pass; the read is bounded so a Redis outage can't hang the request. */
  async retryFailed(name: string): Promise<number | null> {
    const queue = this.queues.get(name);
    if (!queue) return null;
    const failed = await withTimeout(queue.getFailed(), QUEUE_READ_TIMEOUT_MS);
    const results = await Promise.allSettled(failed.map((job) => job.retry()));
    return results.filter((r) => r.status === 'fulfilled').length;
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.allSettled([...this.queues.values()].map((q) => q.close()));
  }
}
