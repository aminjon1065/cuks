import { BullModule, InjectQueue } from '@nestjs/bullmq';
import { Injectable, Module, type OnApplicationBootstrap } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { QUEUE } from '@cuks/shared';
import { RetentionProcessor } from './retention.processor';

/** Daily sweep (docs/modules/12 §8: "корзина 30 дн, temp-uploads 24 ч"). */
@Injectable()
export class RetentionScheduler implements OnApplicationBootstrap {
  constructor(@InjectQueue(QUEUE.retention) private readonly queue: Queue) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.queue.add('sweep', {}, { repeat: { pattern: '0 3 * * *' } });
  }
}

@Module({
  imports: [
    BullModule.registerQueue({ name: QUEUE.retention }),
    // Producer-only — reconcileStalePendingScans() re-enqueues av-scan for
    // versions stuck at 'pending' past STALE_PENDING_SCAN_HOURS.
    BullModule.registerQueue({ name: QUEUE.avScan }),
  ],
  providers: [RetentionProcessor, RetentionScheduler],
})
export class RetentionModule {}
