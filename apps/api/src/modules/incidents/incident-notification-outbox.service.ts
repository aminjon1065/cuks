import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { and, asc, eq, isNull, lte } from 'drizzle-orm';
import { notificationOutbox, type Database } from '@cuks/db';
import { INCIDENT_SEVERITY_MAX, INCIDENT_SEVERITY_MIN, INCIDENT_STATUSES } from '@cuks/shared';
import { z } from 'zod';
import { DB } from '../../common/db/db.module';
import {
  IncidentNotificationsService,
  type IncidentNotificationInput,
} from './incident-notifications.service';

export const INCIDENT_NOTIFICATION_OUTBOX_TOPIC = 'incidents.notification';
const POLL_INTERVAL_MS = 5_000;
const BATCH_SIZE = 25;
const INITIAL_RETRY_MS = 2_000;
const MAX_RETRY_MS = 5 * 60_000;
const MAX_ERROR_LENGTH = 2_000;

const incidentNotificationPayloadSchema = z.object({
  event: z.enum(['created', 'updated', 'status_changed']),
  incidentId: z.string().uuid(),
  number: z.string().min(1).max(100),
  severity: z.number().int().min(INCIDENT_SEVERITY_MIN).max(INCIDENT_SEVERITY_MAX),
  dedupeKey: z.string().min(1).max(500),
  fromStatus: z.enum(INCIDENT_STATUSES).optional(),
  toStatus: z.enum(INCIDENT_STATUSES).optional(),
});

export interface OutboxDispatchResult {
  processed: number;
  failed: number;
}

export function incidentNotificationOutboxValues(input: IncidentNotificationInput) {
  return {
    topic: INCIDENT_NOTIFICATION_OUTBOX_TOPIC,
    payload: input,
    dedupeKey: input.dedupeKey,
  };
}

/** Exponential retry capped at five minutes; `failedAttempts` starts at one. */
export function notificationOutboxRetryAt(failedAttempts: number, now: Date): Date {
  const exponent = Math.max(0, Math.min(failedAttempts - 1, 20));
  const delay = Math.min(MAX_RETRY_MS, INITIAL_RETRY_MS * 2 ** exponent);
  return new Date(now.getTime() + delay);
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, MAX_ERROR_LENGTH);
}

function parsePayload(payload: unknown): IncidentNotificationInput {
  const parsed = incidentNotificationPayloadSchema.parse(payload);
  return {
    event: parsed.event,
    incidentId: parsed.incidentId,
    number: parsed.number,
    severity: parsed.severity,
    dedupeKey: parsed.dedupeKey,
    ...(parsed.fromStatus ? { fromStatus: parsed.fromStatus } : {}),
    ...(parsed.toStatus ? { toStatus: parsed.toStatus } : {}),
  };
}

/**
 * API-side transactional-outbox dispatcher. Multiple API processes can poll the
 * same table safely: each batch is claimed with `FOR UPDATE SKIP LOCKED`.
 * Delivery may be repeated after a crash between fan-out and acknowledgement;
 * the stable domain dedupe key makes notification insertion idempotent.
 */
@Injectable()
export class IncidentNotificationOutboxService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(IncidentNotificationOutboxService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private dispatching = false;

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly delivery: IncidentNotificationsService,
  ) {}

  onModuleInit(): void {
    void this.dispatchPending();
    this.timer = setInterval(() => void this.dispatchPending(), POLL_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Dispatch one due batch, optionally restricted to a just-committed row. */
  async dispatchPending(outboxId?: string): Promise<OutboxDispatchResult> {
    if (this.dispatching) return { processed: 0, failed: 0 };
    this.dispatching = true;
    const now = new Date();
    try {
      return await this.db.transaction(async (tx) => {
        const filters = [
          eq(notificationOutbox.topic, INCIDENT_NOTIFICATION_OUTBOX_TOPIC),
          isNull(notificationOutbox.processedAt),
          lte(notificationOutbox.nextAttemptAt, now),
        ];
        if (outboxId) filters.push(eq(notificationOutbox.id, outboxId));

        const rows = await tx
          .select()
          .from(notificationOutbox)
          .where(and(...filters))
          .orderBy(asc(notificationOutbox.createdAt))
          .limit(outboxId ? 1 : BATCH_SIZE)
          .for('update', { skipLocked: true });

        const result: OutboxDispatchResult = { processed: 0, failed: 0 };
        for (const row of rows) {
          try {
            await this.delivery.deliver(parsePayload(row.payload));
            await tx
              .update(notificationOutbox)
              .set({ processedAt: now, lastError: null, updatedAt: now })
              .where(eq(notificationOutbox.id, row.id));
            result.processed += 1;
          } catch (error) {
            const attempts = row.attempts + 1;
            await tx
              .update(notificationOutbox)
              .set({
                attempts,
                nextAttemptAt: notificationOutboxRetryAt(attempts, now),
                lastError: errorMessage(error),
                updatedAt: now,
              })
              .where(eq(notificationOutbox.id, row.id));
            result.failed += 1;
            this.logger.error(
              { error, outboxId: row.id, attempts },
              'incident notification outbox delivery failed',
            );
          }
        }
        return result;
      });
    } catch (error) {
      this.logger.error({ error, outboxId }, 'incident notification outbox dispatch failed');
      return { processed: 0, failed: 0 };
    } finally {
      this.dispatching = false;
    }
  }
}
