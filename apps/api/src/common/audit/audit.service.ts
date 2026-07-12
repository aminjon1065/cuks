import { Injectable, Logger } from '@nestjs/common';

export interface AuditEvent {
  /** `module.entity.verb` (docs/04 §Logging). */
  action: string;
  actorId?: string | null;
  entityType?: string;
  entityId?: string;
  orgUnitId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  meta?: Record<string, unknown>;
}

/**
 * Audit sink. Phase 0.4 logs events structurally via pino; phase 0.11 adds the
 * partitioned `audit.audit_log` table and persists here (docs/07 §audit).
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger('Audit');

  log(event: AuditEvent): void {
    this.logger.log({ audit: event }, `audit ${event.action}`);
  }
}
