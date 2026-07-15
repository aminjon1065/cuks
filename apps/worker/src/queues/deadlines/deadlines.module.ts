import { BullModule, InjectQueue } from '@nestjs/bullmq';
import { Injectable, Module, type OnApplicationBootstrap } from '@nestjs/common';
import { Queue } from 'bullmq';
import { QUEUE } from '@cuks/shared';
import { DeadlinesProcessor } from './deadlines.processor';

/** Registers the daily 08:00 Asia/Dushanbe deadline-sweep repeatable job (docs/modules/11
 *  §5), idempotent across restarts. */
@Injectable()
export class DeadlinesScheduler implements OnApplicationBootstrap {
  constructor(@InjectQueue(QUEUE.deadlines) private readonly queue: Queue) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.queue.add('sweep', {}, { repeat: { pattern: '0 8 * * *', tz: 'Asia/Dushanbe' } });
  }
}

@Module({
  imports: [BullModule.registerQueue({ name: QUEUE.deadlines })],
  providers: [DeadlinesProcessor, DeadlinesScheduler],
})
export class DeadlinesModule {}
