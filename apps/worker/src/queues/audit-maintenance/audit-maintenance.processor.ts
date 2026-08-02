import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Job } from 'bullmq';
import type { Database } from '@cuks/db';
import { QUEUE } from '@cuks/shared';
import { DB } from '../../common/db.module';
import { JobMetricsService } from '../../common/job-metrics.service';

/**
 * Keeps `audit.audit_log` monthly partitions provisioned a couple of months ahead
 * (docs/07 §audit; the migration only seeds the first few). Idempotent — the DB
 * function no-ops if a partition already exists; the DEFAULT partition catches any
 * gap so a missed run never loses rows.
 */
@Processor(QUEUE.auditMaintenance)
export class AuditMaintenanceProcessor extends WorkerHost {
  private readonly logger = new Logger(AuditMaintenanceProcessor.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly metrics: JobMetricsService,
  ) {
    super();
  }

  /**
   * Times the run and records its outcome (plan этап 4 «метрики длительности/ошибок») before
   * re-throwing unchanged — BullMQ's retry and failed-count behaviour must not change. The most
   * valuable thing recorded here is that the run happened at all: this job is monthly, so a
   * silent month of nothing is exactly what a healthy month looks like in the log.
   */
  async process(job: Job): Promise<void> {
    const startedAt = Date.now();
    try {
      await this.ensurePartitions(job);
    } catch (error) {
      await this.metrics.record('audit-maintenance', startedAt, { ok: false, error });
      throw error;
    }
    // Outside the guarded block on purpose: only the partition work's own failure may reach the
    // branch above. Recorded from inside it, a throw out of the recorder would store a run that
    // did provision its partitions as failed and re-throw it to BullMQ as a failed job.
    //
    // No counts: the DB function is idempotent and reports nothing about what it created, so
    // there is no honest number to record here — a constant «3» would only look like data.
    await this.metrics.record('audit-maintenance', startedAt, { ok: true, counts: {} });
  }

  private async ensurePartitions(_job: Job): Promise<void> {
    for (let n = 0; n <= 2; n++) {
      await this.db.execute(
        sql`select audit.ensure_audit_log_partition((now() + (${n} || ' months')::interval)::date)`,
      );
    }
    this.logger.log('audit_log partitions ensured (current month + 2 ahead)');
  }
}
