import { Inject, Injectable, Logger } from '@nestjs/common';
import { type Database, auditLog } from '@cuks/db';
import { DB } from '../db/db.module';
import { getRequestContext } from '../request-context/request-context';

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
 * Audit sink (docs/07 §audit). Logs the event structurally via pino AND appends it to
 * the partitioned, append-only `audit.audit_log` table. `actorId`/`ip`/`userAgent` are
 * taken from the explicit event, falling back to the ambient request context, so most
 * callers pass only `action` + entity. `log()` stays synchronous/void — the write is
 * fire-and-forget (the pino line is the backstop) so an audit failure can never break
 * the originating action. Durable queueing moves behind BullMQ in phase 0.13.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger('Audit');

  constructor(@Inject(DB) private readonly db: Database) {}

  log(event: AuditEvent): void {
    const ctx = getRequestContext();
    const enriched: AuditEvent = {
      ...event,
      actorId: event.actorId ?? ctx?.actorId ?? null,
      ip: event.ip ?? ctx?.ip ?? null,
      userAgent: event.userAgent ?? ctx?.userAgent ?? null,
      orgUnitId: event.orgUnitId ?? null,
    };
    this.logger.log({ audit: enriched }, `audit ${enriched.action}`);
    void this.persist(enriched);
  }

  private async persist(event: AuditEvent): Promise<void> {
    try {
      await this.db.insert(auditLog).values({
        actorId: event.actorId ?? null,
        action: event.action,
        entityType: event.entityType ?? null,
        entityId: event.entityId ?? null,
        orgUnitId: event.orgUnitId ?? null,
        ip: event.ip ?? null,
        userAgent: event.userAgent ?? null,
        meta: event.meta ?? null,
      });
    } catch (err) {
      this.logger.error({ err, action: event.action }, 'failed to persist audit event');
    }
  }
}
