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
    const enriched = this.enrich(event);
    this.writeLog(enriched);
    void this.persist(enriched);
  }

  /**
   * Await the append when the response immediately reads the audit timeline.
   * Persistence failures remain non-fatal, matching {@link log}.
   */
  async logAndWait(event: AuditEvent): Promise<void> {
    const enriched = this.enrich(event);
    this.writeLog(enriched);
    await this.persist(enriched);
  }

  private enrich(event: AuditEvent): AuditEvent {
    const ctx = getRequestContext();
    return {
      ...event,
      actorId: event.actorId ?? ctx?.actorId ?? null,
      ip: event.ip ?? ctx?.ip ?? null,
      userAgent: event.userAgent ?? ctx?.userAgent ?? null,
      orgUnitId: event.orgUnitId ?? null,
    };
  }

  private writeLog(event: AuditEvent): void {
    this.logger.log({ audit: event }, `audit ${event.action}`);
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
