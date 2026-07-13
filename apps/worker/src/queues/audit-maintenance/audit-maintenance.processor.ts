import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Job } from 'bullmq';
import type { Database } from '@cuks/db';
import { QUEUE } from '@cuks/shared';
import { DB } from '../../common/db.module';

/**
 * Keeps `audit.audit_log` monthly partitions provisioned a couple of months ahead
 * (docs/07 §audit; the migration only seeds the first few). Idempotent — the DB
 * function no-ops if a partition already exists; the DEFAULT partition catches any
 * gap so a missed run never loses rows.
 */
@Processor(QUEUE.auditMaintenance)
export class AuditMaintenanceProcessor extends WorkerHost {
  private readonly logger = new Logger(AuditMaintenanceProcessor.name);

  constructor(@Inject(DB) private readonly db: Database) {
    super();
  }

  async process(_job: Job): Promise<void> {
    for (let n = 0; n <= 2; n++) {
      await this.db.execute(
        sql`select audit.ensure_audit_log_partition((now() + (${n} || ' months')::interval)::date)`,
      );
    }
    this.logger.log('audit_log partitions ensured (current month + 2 ahead)');
  }
}
