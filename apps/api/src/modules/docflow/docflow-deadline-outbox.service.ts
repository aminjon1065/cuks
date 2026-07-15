import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { and, asc, eq, isNull, lte } from 'drizzle-orm';
import { notificationOutbox, type Database } from '@cuks/db';
import {
  DOCFLOW_DEADLINE_TOPIC,
  docflowDeadlinePayloadSchema,
  type DocflowDeadlinePayload,
} from '@cuks/shared';
import { DB } from '../../common/db/db.module';
import { NotificationsService } from '../notifications/notifications.service';

const POLL_INTERVAL_MS = 5_000;
const BATCH_SIZE = 25;
const INITIAL_RETRY_MS = 2_000;
const MAX_RETRY_MS = 5 * 60_000;
const MAX_ERROR_LENGTH = 2_000;

/** Exponential retry capped at five minutes (mirrors the incident outbox). */
function retryAt(failedAttempts: number, now: Date): Date {
  const exponent = Math.max(0, Math.min(failedAttempts - 1, 20));
  return new Date(now.getTime() + Math.min(MAX_RETRY_MS, INITIAL_RETRY_MS * 2 ** exponent));
}

function errorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, MAX_ERROR_LENGTH);
}

/**
 * API-side dispatcher for docflow deadline reminders (docs/modules/11 §5, task 3.8). The
 * worker inserts `docflow.deadline` outbox rows during its daily sweep; this poller claims
 * them (`FOR UPDATE SKIP LOCKED`) and fans out via NotificationsService. The stable outbox
 * dedupe key makes redelivery after a crash idempotent per recipient.
 */
@Injectable()
export class DocflowDeadlineOutboxService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DocflowDeadlineOutboxService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private dispatching = false;

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit(): void {
    void this.dispatchPending();
    this.timer = setInterval(() => void this.dispatchPending(), POLL_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async dispatchPending(): Promise<{ processed: number; failed: number }> {
    if (this.dispatching) return { processed: 0, failed: 0 };
    this.dispatching = true;
    const now = new Date();
    try {
      return await this.db.transaction(async (tx) => {
        const rows = await tx
          .select()
          .from(notificationOutbox)
          .where(
            and(
              eq(notificationOutbox.topic, DOCFLOW_DEADLINE_TOPIC),
              isNull(notificationOutbox.processedAt),
              lte(notificationOutbox.nextAttemptAt, now),
            ),
          )
          .orderBy(asc(notificationOutbox.createdAt))
          .limit(BATCH_SIZE)
          .for('update', { skipLocked: true });

        const result = { processed: 0, failed: 0 };
        for (const row of rows) {
          try {
            await this.deliver(docflowDeadlinePayloadSchema.parse(row.payload), row.dedupeKey);
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
                nextAttemptAt: retryAt(attempts, now),
                lastError: errorMessage(error),
                updatedAt: now,
              })
              .where(eq(notificationOutbox.id, row.id));
            result.failed += 1;
            this.logger.error(
              { error, outboxId: row.id, attempts },
              'docflow deadline delivery failed',
            );
          }
        }
        return result;
      });
    } catch (error) {
      this.logger.error({ error }, 'docflow deadline outbox dispatch failed');
      return { processed: 0, failed: 0 };
    } finally {
      this.dispatching = false;
    }
  }

  private async deliver(payload: DocflowDeadlinePayload, dedupeKey: string): Promise<void> {
    const overdue = payload.tier === 'overdue' || payload.tier === 'escalation';
    // ДСП: the notification carries only the registration number, never the subject (docs/09 §3).
    const body = payload.confidential ? (payload.regNumber ?? 'Документ ДСП') : payload.subject;
    await this.notifications.notifyMany({
      userIds: payload.recipientUserIds,
      type: `docflow.deadline.${payload.tier}`,
      title:
        payload.tier === 'escalation'
          ? 'Эскалация просрочки поручения'
          : overdue
            ? 'Поручение просрочено'
            : 'Приближается срок поручения',
      body,
      entityType: 'document',
      entityId: payload.documentId,
      priority: overdue ? 'critical' : 'normal',
      emailMode: 'offline',
      dedupeKey,
    });
  }
}
