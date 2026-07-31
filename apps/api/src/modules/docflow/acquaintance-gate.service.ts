import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ResolutionProposalsService } from './resolution-proposals.service';

/** The gate is four hours wide, so a minute of latency on opening it is immaterial. */
const SWEEP_INTERVAL_MS = 60_000;

/**
 * Opens pre-execution reading gates whose timeout has passed (docs/modules/11 §12.3).
 *
 * Runs in the api rather than the worker on purpose: the release logic — and the race with
 * a final acknowledgement that it must lose or win exactly once — lives in
 * `ResolutionProposalsService`, and duplicating it in the worker would be two
 * implementations of the same invariant. `releaseIfDue` claims each batch with
 * `released_at is null` in its UPDATE predicate, so several api instances sweeping at once
 * still release each gate once.
 */
@Injectable()
export class AcquaintanceGateService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AcquaintanceGateService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private sweeping = false;

  constructor(private readonly proposals: ResolutionProposalsService) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.sweep(), SWEEP_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Release every due gate. Returns how many actually opened on this pass. */
  async sweep(now: Date = new Date()): Promise<number> {
    if (this.sweeping) return 0;
    this.sweeping = true;
    try {
      const batchIds = await this.proposals.dueBatchIds(now);
      let released = 0;
      for (const batchId of batchIds) {
        try {
          if (await this.proposals.releaseIfDue(batchId, now)) {
            released += 1;
            await this.proposals.notifyExecutorsForBatch(batchId);
          }
        } catch (error) {
          // One stuck gate must not block the others — the sweep runs again in a minute.
          this.logger.error({ error, batchId }, 'acquaintance gate release failed');
        }
      }
      if (released)
        this.logger.log({ released, due: batchIds.length }, 'acquaintance gates opened');
      return released;
    } catch (error) {
      this.logger.error({ error }, 'acquaintance gate sweep failed');
      return 0;
    } finally {
      this.sweeping = false;
    }
  }
}
