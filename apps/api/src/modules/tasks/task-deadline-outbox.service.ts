import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { and, asc, eq, inArray, isNull, lte } from 'drizzle-orm';
import { notificationOutbox, taskProjectMembers, type Database } from '@cuks/db';
import {
  TASKS_DEADLINE_TOPIC,
  tasksDeadlinePayloadSchema,
  type TasksDeadlinePayload,
} from '@cuks/shared';
import { DB } from '../../common/db/db.module';
import { NotificationsService } from '../notifications/notifications.service';

const POLL_INTERVAL_MS = 5_000;
const BATCH_SIZE = 25;
const INITIAL_RETRY_MS = 2_000;
const MAX_RETRY_MS = 5 * 60_000;
const MAX_ERROR_LENGTH = 2_000;

function retryAt(failedAttempts: number, now: Date): Date {
  const exponent = Math.max(0, Math.min(failedAttempts - 1, 20));
  return new Date(now.getTime() + Math.min(MAX_RETRY_MS, INITIAL_RETRY_MS * 2 ** exponent));
}

function errorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, MAX_ERROR_LENGTH);
}

const TITLES: Record<TasksDeadlinePayload['tier'], string> = {
  due_soon: 'Завтра срок задачи',
  due_today: 'Сегодня срок задачи',
  overdue: 'Задача просрочена',
};

/**
 * API-side dispatcher for task deadline reminders (docs/modules/15 §7, task 4.4). The worker's daily
 * sweep inserts `tasks.deadline` outbox rows; this poller claims them (`FOR UPDATE SKIP LOCKED`),
 * filters recipients to current project members (a private card never leaks to a stale assignee),
 * and fans out via NotificationsService. The stable dedupe key makes redelivery idempotent.
 */
@Injectable()
export class TaskDeadlineOutboxService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TaskDeadlineOutboxService.name);
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
              eq(notificationOutbox.topic, TASKS_DEADLINE_TOPIC),
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
            await this.deliver(tasksDeadlinePayloadSchema.parse(row.payload), row.dedupeKey);
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
              'task deadline delivery failed',
            );
          }
        }
        return result;
      });
    } catch (error) {
      this.logger.error({ error }, 'task deadline outbox dispatch failed');
      return { processed: 0, failed: 0 };
    } finally {
      this.dispatching = false;
    }
  }

  private async deliver(payload: TasksDeadlinePayload, dedupeKey: string): Promise<void> {
    const members = await this.db
      .select({ userId: taskProjectMembers.userId })
      .from(taskProjectMembers)
      .where(
        and(
          eq(taskProjectMembers.projectId, payload.projectId),
          inArray(taskProjectMembers.userId, payload.recipientUserIds),
        ),
      );
    const recipients = members.map((m) => m.userId);
    if (recipients.length === 0) return;
    await this.notifications.notifyMany({
      userIds: recipients,
      type: `tasks.deadline.${payload.tier}`,
      title: `${TITLES[payload.tier]} ${payload.projectKey}-${payload.seq}`,
      body: payload.title,
      entityType: 'task',
      entityId: payload.taskId,
      priority: 'normal',
      emailMode: 'offline',
      dedupeKey,
    });
  }
}
