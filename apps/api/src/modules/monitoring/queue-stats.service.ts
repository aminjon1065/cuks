import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import { QUEUE, type QueueStats } from '@cuks/shared';
import { ConfigService } from '../../config/config.service';

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
          const c = await queue.getJobCounts('waiting', 'active', 'failed', 'delayed', 'completed');
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

  /** Re-enqueue every failed job on one queue; returns how many were retried. Unknown queue -> null. */
  async retryFailed(name: string): Promise<number | null> {
    const queue = this.queues.get(name);
    if (!queue) return null;
    const failed = await queue.getFailed();
    await Promise.all(failed.map((job) => job.retry()));
    return failed.length;
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.allSettled([...this.queues.values()].map((q) => q.close()));
  }
}
