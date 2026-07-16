import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { aliasedTable, and, eq, isNotNull, isNull } from 'drizzle-orm';
import type { Job } from 'bullmq';
import {
  documents,
  notificationOutbox,
  positions,
  resolutions,
  taskProjects,
  tasks,
  userPositions,
  type Database,
} from '@cuks/db';
import {
  DOCFLOW_DEADLINE_TOPIC,
  QUEUE,
  TASKS_DEADLINE_TOPIC,
  classifyDeadline,
  classifyTaskDeadline,
  type DocflowDeadlinePayload,
  type DocflowDeadlineTier,
  type TaskDeadlineTier,
  type TasksDeadlinePayload,
} from '@cuks/shared';
import { DB } from '../../common/db.module';

const DUSHANBE_OFFSET_MS = 5 * 60 * 60 * 1000;

// The executor's position/unit vs the head's position — aliased to join the same tables twice.
const execPosition = aliasedTable(positions, 'exec_position');
const headPosition = aliasedTable(positions, 'head_position');
const headUserPosition = aliasedTable(userPositions, 'head_user_position');

/**
 * Deadline/escalation daily sweep (docs/modules/11 §5, task 3.8). Scans controlled active
 * resolutions with a due date, classifies each against Asia/Dushanbe calendar days, and
 * writes `docflow.deadline` outbox rows: a reminder to the executor at 3 / 1 / 0 days out,
 * an overdue reminder (executor + resolution author) every day once past due, and — past 5
 * days overdue — an escalation to the executor's subdivision head. The API dispatcher fans
 * these out; a per-day dedupe key keeps a re-run idempotent within the day.
 */
@Processor(QUEUE.deadlines)
export class DeadlinesProcessor extends WorkerHost {
  private readonly logger = new Logger(DeadlinesProcessor.name);

  constructor(@Inject(DB) private readonly db: Database) {
    super();
  }

  async process(job: Job): Promise<void> {
    const now = new Date();
    const day = new Date(now.getTime() + DUSHANBE_OFFSET_MS).toISOString().slice(0, 10);

    const rows = await this.db
      .select({
        resolutionId: resolutions.id,
        documentId: resolutions.documentId,
        executorId: resolutions.executorId,
        authorId: resolutions.authorId,
        dueDate: resolutions.dueDate,
        subject: documents.subject,
        regNumber: documents.regNumber,
        confidentiality: documents.confidentiality,
        docAuthorId: documents.authorId,
        accessList: documents.accessList,
      })
      .from(resolutions)
      .innerJoin(
        documents,
        and(eq(documents.id, resolutions.documentId), isNull(documents.deletedAt)),
      )
      .where(
        and(
          eq(resolutions.isControl, true),
          eq(resolutions.status, 'active'),
          isNotNull(resolutions.dueDate),
        ),
      );

    let emitted = 0;
    for (const r of rows) {
      try {
        const dueIso = r.dueDate!.toISOString();
        const c = classifyDeadline(dueIso, now);
        const base = {
          documentId: r.documentId,
          subject: r.subject,
          regNumber: r.regNumber,
          confidential: r.confidentiality === 'dsp',
          dueDate: dueIso,
        };

        if (c.reminder) {
          emitted += await this.emit(r.resolutionId, day, c.reminder, [r.executorId], base);
        }
        if (c.overdue) {
          emitted += await this.emit(
            r.resolutionId,
            day,
            'overdue',
            [r.executorId, r.authorId],
            base,
          );
        }
        if (c.escalation) {
          let heads = await this.subdivisionHeads(r.executorId);
          if (r.confidentiality === 'dsp') {
            // ДСП documents never leak outside the allow-list (docs/modules/11 §2). A
            // subdivision head who is neither the document author nor access-listed has no
            // clearance for the subject, so the escalation would carry it to them via a
            // critical (force-on) notification — drop such heads. Non-ДСП documents are
            // visible to owner-subdivision leadership, so their heads stay.
            const cleared = new Set<string>([r.docAuthorId, ...r.accessList]);
            heads = heads.filter((id) => cleared.has(id));
          }
          if (heads.length) {
            emitted += await this.emit(r.resolutionId, day, 'escalation', heads, base);
          }
        }
      } catch (error) {
        // One bad resolution (e.g. an executor with no resolvable unit) must not abort the
        // whole daily sweep — log and continue.
        this.logger.error({ error, resolutionId: r.resolutionId }, 'deadline item failed');
      }
    }
    const taskEmitted = await this.sweepTasks(now, day);
    this.logger.log(
      { jobId: job.id, scanned: rows.length, emitted, taskEmitted },
      'deadline sweep',
    );
  }

  /**
   * Task deadline sweep (docs/modules/15 §7, task 4.4). Scans active (not done/archived) tasks with
   * a due date: a reminder to the assignees a day out and on the due day, and — once overdue — a
   * daily overdue reminder to the assignees and the author. Recipients are filtered to project
   * members downstream by the API dispatcher.
   */
  private async sweepTasks(now: Date, day: string): Promise<number> {
    const rows = await this.db
      .select({
        taskId: tasks.id,
        projectId: tasks.projectId,
        projectKey: taskProjects.key,
        seq: tasks.seq,
        title: tasks.title,
        dueAt: tasks.dueAt,
        assigneeIds: tasks.assigneeIds,
        authorId: tasks.authorId,
      })
      .from(tasks)
      .innerJoin(
        taskProjects,
        and(eq(taskProjects.id, tasks.projectId), isNull(taskProjects.deletedAt)),
      )
      .where(
        and(
          isNotNull(tasks.dueAt),
          isNull(tasks.deletedAt),
          isNull(tasks.archivedAt),
          isNull(tasks.completedAt),
        ),
      );

    let emitted = 0;
    for (const r of rows) {
      try {
        const c = classifyTaskDeadline(r.dueAt!.toISOString(), now);
        const base = {
          taskId: r.taskId,
          projectId: r.projectId,
          projectKey: r.projectKey,
          seq: r.seq,
          title: r.title,
        };
        if (c.reminder) {
          emitted += await this.emitTask(day, c.reminder, r.assigneeIds, base);
        }
        if (c.overdue) {
          emitted += await this.emitTask(day, 'overdue', [...r.assigneeIds, r.authorId], base);
        }
      } catch (error) {
        this.logger.error({ error, taskId: r.taskId }, 'task deadline item failed');
      }
    }
    return emitted;
  }

  /** Insert one outbox row for a (task, tier, day); idempotent via the dedupe key. */
  private async emitTask(
    day: string,
    tier: TaskDeadlineTier,
    recipientUserIds: string[],
    base: { taskId: string; projectId: string; projectKey: string; seq: number; title: string },
  ): Promise<number> {
    const recipients = [...new Set(recipientUserIds)];
    if (recipients.length === 0) return 0;
    const payload: TasksDeadlinePayload = { ...base, tier, recipientUserIds: recipients };
    const dedupeKey = `${TASKS_DEADLINE_TOPIC}:${base.taskId}:${tier}:${day}`;
    const inserted = await this.db
      .insert(notificationOutbox)
      .values({ topic: TASKS_DEADLINE_TOPIC, payload, dedupeKey })
      .onConflictDoNothing({ target: notificationOutbox.dedupeKey })
      .returning({ id: notificationOutbox.id });
    return inserted.length;
  }

  /** Insert one outbox row for a (resolution, tier, day); idempotent via the dedupe key. */
  private async emit(
    resolutionId: string,
    day: string,
    tier: DocflowDeadlineTier,
    recipientUserIds: string[],
    base: {
      documentId: string;
      subject: string;
      regNumber: string | null;
      confidential: boolean;
      dueDate: string;
    },
  ): Promise<number> {
    const recipients = [...new Set(recipientUserIds)];
    if (recipients.length === 0) return 0;
    const payload: DocflowDeadlinePayload = {
      resolutionId,
      tier,
      recipientUserIds: recipients,
      ...base,
    };
    const dedupeKey = `${DOCFLOW_DEADLINE_TOPIC}:${resolutionId}:${tier}:${day}`;
    const inserted = await this.db
      .insert(notificationOutbox)
      .values({ topic: DOCFLOW_DEADLINE_TOPIC, payload, dedupeKey })
      .onConflictDoNothing({ target: notificationOutbox.dedupeKey })
      .returning({ id: notificationOutbox.id });
    return inserted.length;
  }

  /** Head users of the executor's subdivision (positions.isHead), excluding the executor
   *  themselves (no self-escalation). */
  private async subdivisionHeads(executorId: string): Promise<string[]> {
    const rows = await this.db
      .selectDistinct({ userId: headUserPosition.userId })
      .from(userPositions)
      .innerJoin(execPosition, eq(execPosition.id, userPositions.positionId))
      .innerJoin(
        headPosition,
        and(
          eq(headPosition.orgUnitId, execPosition.orgUnitId),
          eq(headPosition.isHead, true),
          isNull(headPosition.deletedAt),
        ),
      )
      .innerJoin(headUserPosition, eq(headUserPosition.positionId, headPosition.id))
      .where(eq(userPositions.userId, executorId));
    return rows.map((r) => r.userId).filter((id) => id !== executorId);
  }
}
