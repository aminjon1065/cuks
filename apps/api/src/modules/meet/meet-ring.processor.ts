import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { QUEUE, type MeetRingJobData } from '@cuks/shared';
import { RingService } from './ring.service';

/**
 * The «no answer» timer for a 1:1 ring (docs/modules/14 §2). Registered in the API process — not the
 * worker — so it can emit realtime events and post a system message. If the ring was already
 * answered/declined/cancelled (its Redis key is gone), {@link RingService.handleTimeout} no-ops.
 */
@Processor(QUEUE.meetRing)
export class MeetRingProcessor extends WorkerHost {
  constructor(private readonly ring: RingService) {
    super();
  }

  async process(job: Job<MeetRingJobData>): Promise<void> {
    await this.ring.handleTimeout(job.data);
  }
}
