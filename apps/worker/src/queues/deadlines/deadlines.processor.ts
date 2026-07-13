import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { QUEUE } from '@cuks/shared';

/**
 * Deadline/escalation sweep (docs/01 §73 `docflow-deadlines`). Phase-0.13 stub —
 * the real overdue-detection + escalation logic lands with the docflow/tasks
 * modules; this proves the cron wiring runs.
 */
@Processor(QUEUE.deadlines)
export class DeadlinesProcessor extends WorkerHost {
  private readonly logger = new Logger(DeadlinesProcessor.name);

  process(job: Job): Promise<void> {
    this.logger.log({ jobId: job.id }, 'deadline sweep (stub — no deadlines yet)');
    return Promise.resolve();
  }
}
