import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { QUEUE, type MeetReminderJobData } from '@cuks/shared';
import { MeetingsService } from './meetings.service';

/**
 * The «15 minutes before» meeting reminder (docs/modules/14 §2). Registered in the API process — not
 * the worker — so it can fan out realtime notifications. {@link MeetingsService.remind} no-ops if the
 * meeting was cancelled/rescheduled (its jobId was removed) or is no longer scheduled.
 */
@Processor(QUEUE.meetReminder)
export class MeetReminderProcessor extends WorkerHost {
  constructor(private readonly meetings: MeetingsService) {
    super();
  }

  async process(job: Job<MeetReminderJobData>): Promise<void> {
    await this.meetings.remind(job.data.meetingId);
  }
}
