import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  taskActivity,
  taskChecklistItems,
  taskColumns,
  taskLabels,
  taskProjects,
  tasks,
  type Database,
} from '@cuks/db';
import {
  keyBetween,
  tiptapPlainText,
  wsRooms,
  type BoardDto,
  type ColumnDto,
  type CreateTaskInput,
  type LabelDto,
  type MoveTaskInput,
  type ProjectRole,
  type TaskCardDto,
  type UpdateTaskInput,
} from '@cuks/shared';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthUser } from '../../common/auth/auth-user';
import { AppException } from '../../common/exceptions/app.exception';
import { DB } from '../../common/db/db.module';
import { RealtimeService } from '../events/realtime.service';
import { TasksAclService } from './tasks-acl.service';
import { ProjectsService } from './projects.service';

type TaskRow = typeof tasks.$inferSelect;
type ColumnRow = typeof taskColumns.$inferSelect;
/** A Drizzle transaction handle — the same query surface as `Database`. */
type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

@Injectable()
export class TasksService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly acl: TasksAclService,
    private readonly projects: ProjectsService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
  ) {}

  // --- Board -----------------------------------------------------------------

  /** The whole board in one request (docs/modules/15 §8). */
  async board(projectId: string, actor: AuthUser): Promise<BoardDto> {
    const project = await this.acl.loadViewable(projectId, actor);
    const [columns, labels, cardRows, members] = await Promise.all([
      this.db
        .select()
        .from(taskColumns)
        .where(and(eq(taskColumns.projectId, projectId), isNull(taskColumns.deletedAt)))
        .orderBy(asc(taskColumns.orderKey)),
      this.db.select().from(taskLabels).where(eq(taskLabels.projectId, projectId)),
      this.db
        .select()
        .from(tasks)
        .where(
          and(eq(tasks.projectId, projectId), isNull(tasks.deletedAt), isNull(tasks.archivedAt)),
        )
        .orderBy(asc(tasks.orderInColumn)),
      this.projects.memberDirectory(projectId),
    ]);
    const checklist = await this.checklistCounts(cardRows.map((c) => c.id));
    return {
      project: {
        id: project.id,
        name: project.name,
        key: project.key,
        description: project.description,
        orgUnitId: project.orgUnitId,
        visibleToOrgUnit: project.visibleToOrgUnit,
        isArchived: project.isArchived,
        myRole: (await this.acl.roleFor(projectId, actor.id)) as ProjectRole | null,
        createdAt: project.createdAt.toISOString(),
      },
      columns: columns.map((c): ColumnDto => this.columnDto(c)),
      labels: labels.map((l): LabelDto => ({ id: l.id, name: l.name, color: l.color })),
      members,
      cards: cardRows.map((c) => this.cardDto(c, checklist.get(c.id))),
    };
  }

  // --- Cards -----------------------------------------------------------------

  async createCard(
    projectId: string,
    input: CreateTaskInput,
    actor: AuthUser,
  ): Promise<TaskCardDto> {
    await this.acl.loadWithRole(projectId, actor, 'editor');
    const column = await this.requireColumn(projectId, input.columnId);

    const card = await this.db.transaction(async (tx) => {
      // Mint the per-project card number atomically (row lock on the project counter).
      const [seqRow] = await tx
        .update(taskProjects)
        .set({ lastSeq: sql`${taskProjects.lastSeq} + 1` })
        .where(eq(taskProjects.id, projectId))
        .returning({ seq: taskProjects.lastSeq });
      const seq = seqRow!.seq;
      const [last] = await tx
        .select({ orderKey: tasks.orderInColumn })
        .from(tasks)
        .where(and(eq(tasks.columnId, input.columnId), isNull(tasks.deletedAt)))
        .orderBy(desc(tasks.orderInColumn))
        .limit(1);
      const description = input.description ?? null;
      const [t] = await tx
        .insert(tasks)
        .values({
          projectId,
          columnId: input.columnId,
          seq: seq!,
          title: input.title,
          description,
          descriptionText: description ? tiptapPlainText(description) : null,
          assigneeIds: input.assigneeIds,
          authorId: actor.id,
          priority: input.priority,
          dueAt: input.dueAt ? new Date(input.dueAt) : null,
          startAt: input.startAt ? new Date(input.startAt) : null,
          labels: input.labels,
          orderInColumn: keyBetween(last?.orderKey ?? null, null),
          completedAt: column.isDoneColumn ? new Date() : null,
        })
        .returning();
      await tx.insert(taskActivity).values({
        taskId: t!.id,
        actorId: actor.id,
        action: 'tasks.card.created',
        meta: { columnId: input.columnId },
      });
      return t!;
    });
    this.audit.log({
      action: 'tasks.card.created',
      actorId: actor.id,
      entityType: 'task',
      entityId: card.id,
    });
    this.emitCard(projectId, card.id, 'tasks.card.created', actor.id);
    return this.cardDto(card, undefined);
  }

  async updateCard(taskId: string, input: UpdateTaskInput, actor: AuthUser): Promise<TaskCardDto> {
    const card = await this.requireCardWithRole(taskId, actor, 'editor');
    const description = input.description;
    await this.db
      .update(tasks)
      .set({
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(description !== undefined
          ? {
              description: description ?? null,
              descriptionText: description ? tiptapPlainText(description) : null,
            }
          : {}),
        ...(input.assigneeIds !== undefined ? { assigneeIds: input.assigneeIds } : {}),
        ...(input.watcherIds !== undefined ? { watcherIds: input.watcherIds } : {}),
        ...(input.priority !== undefined ? { priority: input.priority } : {}),
        ...(input.dueAt !== undefined ? { dueAt: input.dueAt ? new Date(input.dueAt) : null } : {}),
        ...(input.startAt !== undefined
          ? { startAt: input.startAt ? new Date(input.startAt) : null }
          : {}),
        ...(input.labels !== undefined ? { labels: input.labels } : {}),
        updatedAt: new Date(),
      })
      .where(eq(tasks.id, taskId));
    this.emitCard(card.projectId, taskId, 'tasks.card.updated', actor.id);
    return this.reloadCard(taskId);
  }

  /** Move a card into a column at a position (docs/modules/15 §3). Entering a done column
   *  completes it; leaving one clears the completion. */
  async moveCard(taskId: string, input: MoveTaskInput, actor: AuthUser): Promise<TaskCardDto> {
    const card = await this.requireCardWithRole(taskId, actor, 'editor');
    const column = await this.requireColumn(card.projectId, input.columnId);
    const enteringDone = column.isDoneColumn;
    // Serialize order mutations within the project (the same row lock createCard holds), so two
    // concurrent moves cannot read the same neighbours and mint a duplicate order key.
    await this.db.transaction(async (tx) => {
      await tx
        .select({ id: taskProjects.id })
        .from(taskProjects)
        .where(eq(taskProjects.id, card.projectId))
        .for('update');
      const [before, after] = await this.cardNeighbourKeys(
        tx,
        input.columnId,
        input.afterTaskId,
        taskId,
      );
      await tx
        .update(tasks)
        .set({
          columnId: input.columnId,
          orderInColumn: keyBetween(before, after),
          completedAt: enteringDone ? (card.completedAt ?? new Date()) : null,
          updatedAt: new Date(),
        })
        .where(eq(tasks.id, taskId));
      await tx.insert(taskActivity).values({
        taskId,
        actorId: actor.id,
        action: 'tasks.card.moved',
        meta: { columnId: input.columnId },
      });
    });
    this.audit.log({
      action: 'tasks.card.moved',
      actorId: actor.id,
      entityType: 'task',
      entityId: taskId,
      meta: { columnId: input.columnId },
    });
    this.realtime.emitToRoom(wsRooms.board(card.projectId), 'tasks.card.moved', {
      projectId: card.projectId,
      taskId,
      columnId: input.columnId,
      actorId: actor.id,
    });
    return this.reloadCard(taskId);
  }

  async archiveCard(taskId: string, actor: AuthUser): Promise<void> {
    const card = await this.requireCardWithRole(taskId, actor, 'editor');
    await this.db
      .update(tasks)
      .set({ archivedAt: new Date(), updatedAt: new Date() })
      .where(eq(tasks.id, taskId));
    this.emitCard(card.projectId, taskId, 'tasks.card.updated', actor.id);
  }

  // --- Helpers ---------------------------------------------------------------

  private columnDto(c: ColumnRow): ColumnDto {
    return {
      id: c.id,
      name: c.name,
      orderKey: c.orderKey,
      wipLimit: c.wipLimit,
      isDoneColumn: c.isDoneColumn,
    };
  }

  private cardDto(c: TaskRow, counts: { done: number; total: number } | undefined): TaskCardDto {
    return {
      id: c.id,
      seq: c.seq,
      columnId: c.columnId,
      orderKey: c.orderInColumn,
      title: c.title,
      priority: c.priority,
      dueAt: c.dueAt?.toISOString() ?? null,
      assigneeIds: c.assigneeIds,
      labels: c.labels,
      checklistDone: counts?.done ?? 0,
      checklistTotal: counts?.total ?? 0,
      commentCount: 0,
      completedAt: c.completedAt?.toISOString() ?? null,
      archivedAt: c.archivedAt?.toISOString() ?? null,
    };
  }

  private async checklistCounts(
    taskIds: string[],
  ): Promise<Map<string, { done: number; total: number }>> {
    if (!taskIds.length) return new Map();
    const rows = await this.db
      .select({
        taskId: taskChecklistItems.taskId,
        total: sql<number>`count(*)::int`,
        done: sql<number>`count(*) filter (where ${taskChecklistItems.isDone})::int`,
      })
      .from(taskChecklistItems)
      .where(inArray(taskChecklistItems.taskId, taskIds))
      .groupBy(taskChecklistItems.taskId);
    return new Map(rows.map((r) => [r.taskId, { done: r.done, total: r.total }]));
  }

  private async requireColumn(projectId: string, columnId: string): Promise<ColumnRow> {
    const [col] = await this.db
      .select()
      .from(taskColumns)
      .where(
        and(
          eq(taskColumns.id, columnId),
          eq(taskColumns.projectId, projectId),
          isNull(taskColumns.deletedAt),
        ),
      )
      .limit(1);
    if (!col) throw AppException.notFound('tasks.column.not_found', 'Column not found');
    return col;
  }

  private async requireCardWithRole(
    taskId: string,
    actor: AuthUser,
    min: ProjectRole,
  ): Promise<TaskRow> {
    const [card] = await this.db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, taskId), isNull(tasks.deletedAt)))
      .limit(1);
    if (!card) throw AppException.notFound('tasks.card.not_found', 'Card not found');
    await this.acl.loadWithRole(card.projectId, actor, min);
    return card;
  }

  private async reloadCard(taskId: string): Promise<TaskCardDto> {
    const [card] = await this.db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
    const counts = await this.checklistCounts([taskId]);
    return this.cardDto(card!, counts.get(taskId));
  }

  private async cardNeighbourKeys(
    exec: Database | Tx,
    columnId: string,
    afterTaskId: string | null,
    excludeId: string,
  ): Promise<[string | null, string | null]> {
    const cards = (
      await exec
        .select({ id: tasks.id, orderKey: tasks.orderInColumn })
        .from(tasks)
        .where(and(eq(tasks.columnId, columnId), isNull(tasks.deletedAt), isNull(tasks.archivedAt)))
        .orderBy(asc(tasks.orderInColumn))
    ).filter((c) => c.id !== excludeId);
    if (afterTaskId === null) return [null, cards[0]?.orderKey ?? null];
    const idx = cards.findIndex((c) => c.id === afterTaskId);
    if (idx === -1) throw AppException.notFound('tasks.card.not_found', 'Card not found');
    return [cards[idx]!.orderKey, cards[idx + 1]?.orderKey ?? null];
  }

  private emitCard(
    projectId: string,
    taskId: string,
    event: 'tasks.card.created' | 'tasks.card.updated',
    actorId: string,
  ): void {
    this.realtime.emitToRoom(wsRooms.board(projectId), event, { projectId, taskId, actorId });
  }
}
