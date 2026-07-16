import { Inject, Injectable } from '@nestjs/common';
import {
  aliasedTable,
  and,
  arrayContains,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lt,
  sql,
} from 'drizzle-orm';
import {
  comments,
  taskActivity,
  taskChecklistItems,
  taskColumns,
  taskLabels,
  taskProjectMembers,
  taskProjects,
  tasks,
  users,
  type Database,
} from '@cuks/db';
import {
  keyBetween,
  tiptapPlainText,
  wsRooms,
  type ActivityDto,
  type BoardDto,
  type ChecklistItemDto,
  type ColumnDto,
  type CreateTaskInput,
  type LabelDto,
  type MoveTaskInput,
  type MyTaskDto,
  type ProjectRole,
  type TaskCardDetailDto,
  type TaskCardDto,
  type UpdateTaskInput,
} from '@cuks/shared';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthUser } from '../../common/auth/auth-user';
import { AppException } from '../../common/exceptions/app.exception';
import { DB } from '../../common/db/db.module';
import { RealtimeService } from '../events/realtime.service';
import { NotificationsService } from '../notifications/notifications.service';
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
    private readonly notifications: NotificationsService,
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
    const cardIds = cardRows.map((c) => c.id);
    const [checklist, commentCounts] = await Promise.all([
      this.checklistCounts(cardIds),
      this.commentCounts(cardIds),
    ]);
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
      cards: cardRows.map((c) =>
        this.cardDto(c, checklist.get(c.id), commentCounts.get(c.id) ?? 0),
      ),
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

  /** Edit card fields (docs/modules/15 §4). Only genuinely-changed fields are written, each recorded
   *  in the «История» trail; newly-added assignees who are project members are notified. */
  async updateCard(taskId: string, input: UpdateTaskInput, actor: AuthUser): Promise<TaskCardDto> {
    const card = await this.requireCardWithRole(taskId, actor, 'editor');
    const set: Partial<TaskRow> = {};
    const fields: string[] = [];

    if (input.title !== undefined && input.title !== card.title) {
      set.title = input.title;
      fields.push('title');
    }
    if (input.description !== undefined) {
      const description = input.description ?? null;
      if (JSON.stringify(description) !== JSON.stringify(card.description ?? null)) {
        set.description = description;
        set.descriptionText = description ? tiptapPlainText(description) : null;
        fields.push('description');
      }
    }
    if (input.priority !== undefined && input.priority !== card.priority) {
      set.priority = input.priority;
      fields.push('priority');
    }
    if (input.dueAt !== undefined) {
      const next = input.dueAt ? new Date(input.dueAt) : null;
      if ((next?.getTime() ?? null) !== (card.dueAt?.getTime() ?? null)) {
        set.dueAt = next;
        fields.push('dueAt');
      }
    }
    if (input.startAt !== undefined) {
      const next = input.startAt ? new Date(input.startAt) : null;
      if ((next?.getTime() ?? null) !== (card.startAt?.getTime() ?? null)) {
        set.startAt = next;
        fields.push('startAt');
      }
    }
    if (input.labels !== undefined && !sameSet(input.labels, card.labels)) {
      set.labels = input.labels;
      fields.push('labels');
    }
    if (input.watcherIds !== undefined && !sameSet(input.watcherIds, card.watcherIds)) {
      set.watcherIds = input.watcherIds;
      fields.push('watchers');
    }
    let addedAssignees: string[] = [];
    if (input.assigneeIds !== undefined && !sameSet(input.assigneeIds, card.assigneeIds)) {
      set.assigneeIds = input.assigneeIds;
      addedAssignees = input.assigneeIds.filter((id) => !card.assigneeIds.includes(id));
    }

    if (fields.length === 0 && set.assigneeIds === undefined) return this.reloadCard(taskId);

    await this.db
      .update(tasks)
      .set({ ...set, updatedAt: new Date() })
      .where(eq(tasks.id, taskId));

    if (set.assigneeIds !== undefined) {
      await this.db.insert(taskActivity).values({
        taskId,
        actorId: actor.id,
        action: 'tasks.card.assigned',
        meta: { added: addedAssignees, assigneeIds: input.assigneeIds },
      });
    }
    if (fields.length) {
      await this.db.insert(taskActivity).values({
        taskId,
        actorId: actor.id,
        action: 'tasks.card.updated',
        meta: { fields },
      });
    }
    this.audit.log({
      action: 'tasks.card.updated',
      actorId: actor.id,
      entityType: 'task',
      entityId: taskId,
      meta: { fields: [...fields, ...(set.assigneeIds !== undefined ? ['assignees'] : [])] },
    });
    this.emitCard(card.projectId, taskId, 'tasks.card.updated', actor.id);
    if (addedAssignees.length) await this.notifyAssigned(card, addedAssignees, actor);
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
    if (enteringDone && !card.completedAt) {
      await this.db.insert(taskActivity).values({
        taskId,
        actorId: actor.id,
        action: 'tasks.card.completed',
        meta: {},
      });
      this.audit.log({
        action: 'tasks.card.completed',
        actorId: actor.id,
        entityType: 'task',
        entityId: taskId,
      });
    }
    // Notify watchers (self-subscribed members) when the status column actually changes.
    if (input.columnId !== card.columnId) {
      await this.notifyStatusChange(card, column, actor);
    }
    return this.reloadCard(taskId);
  }

  /** The full card behind the SidePanel (docs/modules/15 §4) — all fields + checklist. Viewer. */
  async cardDetail(taskId: string, actor: AuthUser): Promise<TaskCardDetailDto> {
    const card = await this.requireCardWithRole(taskId, actor, 'viewer');
    const [checklistRows, [commentRow]] = await Promise.all([
      this.db
        .select()
        .from(taskChecklistItems)
        .where(eq(taskChecklistItems.taskId, taskId))
        .orderBy(asc(taskChecklistItems.orderKey)),
      this.db
        .select({ total: count() })
        .from(comments)
        .where(
          and(
            eq(comments.entityType, 'task'),
            eq(comments.entityId, taskId),
            isNull(comments.deletedAt),
          ),
        ),
    ]);
    const checklist: ChecklistItemDto[] = checklistRows.map((r) => ({
      id: r.id,
      text: r.text,
      isDone: r.isDone,
      orderKey: r.orderKey,
    }));
    const done = checklist.filter((c) => c.isDone).length;
    const base = this.cardDto(
      card,
      { done, total: checklist.length },
      Number(commentRow?.total ?? 0),
    );
    return {
      ...base,
      projectId: card.projectId,
      description: card.description ?? null,
      descriptionText: card.descriptionText,
      watcherIds: card.watcherIds,
      authorId: card.authorId,
      startAt: card.startAt?.toISOString() ?? null,
      createdAt: card.createdAt.toISOString(),
      updatedAt: card.updatedAt.toISOString(),
      checklist,
    };
  }

  /** «Завершить» — move the card into the project's done column (docs/modules/15 §4). */
  async completeCard(taskId: string, actor: AuthUser): Promise<TaskCardDto> {
    const card = await this.requireCardWithRole(taskId, actor, 'editor');
    const [done] = await this.db
      .select()
      .from(taskColumns)
      .where(
        and(
          eq(taskColumns.projectId, card.projectId),
          eq(taskColumns.isDoneColumn, true),
          isNull(taskColumns.deletedAt),
        ),
      )
      .orderBy(asc(taskColumns.orderKey))
      .limit(1);
    if (!done) {
      throw AppException.badRequest('tasks.column.no_done', 'Project has no done column');
    }
    return this.moveCard(taskId, { columnId: done.id, afterTaskId: null }, actor);
  }

  /** «Копировать» — duplicate a card (fresh number, same fields, copied checklist). */
  async copyCard(taskId: string, actor: AuthUser): Promise<TaskCardDto> {
    const card = await this.requireCardWithRole(taskId, actor, 'editor');
    const column = await this.requireColumn(card.projectId, card.columnId);
    const items = await this.db
      .select()
      .from(taskChecklistItems)
      .where(eq(taskChecklistItems.taskId, taskId))
      .orderBy(asc(taskChecklistItems.orderKey));
    const copy = await this.db.transaction(async (tx) => {
      const [seqRow] = await tx
        .update(taskProjects)
        .set({ lastSeq: sql`${taskProjects.lastSeq} + 1` })
        .where(eq(taskProjects.id, card.projectId))
        .returning({ seq: taskProjects.lastSeq });
      const [last] = await tx
        .select({ orderKey: tasks.orderInColumn })
        .from(tasks)
        .where(and(eq(tasks.columnId, card.columnId), isNull(tasks.deletedAt)))
        .orderBy(desc(tasks.orderInColumn))
        .limit(1);
      const [t] = await tx
        .insert(tasks)
        .values({
          projectId: card.projectId,
          columnId: card.columnId,
          seq: seqRow!.seq,
          title: `${card.title} (копия)`,
          description: card.description ?? null,
          descriptionText: card.descriptionText,
          assigneeIds: card.assigneeIds,
          authorId: actor.id,
          priority: card.priority,
          dueAt: card.dueAt,
          startAt: card.startAt,
          labels: card.labels,
          orderInColumn: keyBetween(last?.orderKey ?? null, null),
          // Keep the invariant «card in a done column has completedAt set».
          completedAt: column.isDoneColumn ? new Date() : null,
        })
        .returning();
      const newId = t!.id;
      if (items.length) {
        await tx.insert(taskChecklistItems).values(
          items.map((i) => ({
            taskId: newId,
            text: i.text,
            isDone: false,
            orderKey: i.orderKey,
          })),
        );
      }
      await tx.insert(taskActivity).values({
        taskId: newId,
        actorId: actor.id,
        action: 'tasks.card.created',
        meta: { copiedFrom: taskId },
      });
      return t!;
    });
    this.audit.log({
      action: 'tasks.card.created',
      actorId: actor.id,
      entityType: 'task',
      entityId: copy.id,
      meta: { copiedFrom: taskId },
    });
    this.emitCard(card.projectId, copy.id, 'tasks.card.created', actor.id);
    return this.reloadCard(copy.id);
  }

  /** Self-subscribe / unsubscribe as a watcher (docs/modules/15 §4) — any project viewer. */
  async setWatching(
    taskId: string,
    watching: boolean,
    actor: AuthUser,
  ): Promise<TaskCardDetailDto> {
    const card = await this.requireCardWithRole(taskId, actor, 'viewer');
    const isWatching = card.watcherIds.includes(actor.id);
    if (watching !== isWatching) {
      const next = watching
        ? [...card.watcherIds, actor.id]
        : card.watcherIds.filter((id) => id !== actor.id);
      await this.db
        .update(tasks)
        .set({ watcherIds: next, updatedAt: new Date() })
        .where(eq(tasks.id, taskId));
      this.emitCard(card.projectId, taskId, 'tasks.card.updated', actor.id);
    }
    return this.cardDetail(taskId, actor);
  }

  /** The «История» trail, newest first, with actor display names (docs/modules/15 §4). */
  async listActivity(taskId: string, actor: AuthUser): Promise<ActivityDto[]> {
    await this.requireCardWithRole(taskId, actor, 'viewer');
    const author = aliasedTable(users, 'activity_actor');
    const rows = await this.db
      .select({
        id: taskActivity.id,
        actorId: taskActivity.actorId,
        actorName: author.shortName,
        action: taskActivity.action,
        meta: taskActivity.meta,
        createdAt: taskActivity.createdAt,
      })
      .from(taskActivity)
      .leftJoin(author, eq(author.id, taskActivity.actorId))
      .where(eq(taskActivity.taskId, taskId))
      .orderBy(desc(taskActivity.createdAt));
    return rows.map((r) => ({
      id: r.id,
      actorId: r.actorId,
      actorName: r.actorName,
      action: r.action,
      meta: (r.meta as Record<string, unknown> | null) ?? null,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  // --- «Мои задачи» (docs/modules/15 §5) ---

  /** Active tasks across all the caller's projects that they are assigned to (or, when `watching`,
   *  watch), earliest due first (no-due last). Scoped to projects they are a member of. */
  async myTasks(actor: AuthUser, watching: boolean): Promise<MyTaskDto[]> {
    const idColumn = watching ? tasks.watcherIds : tasks.assigneeIds;
    const rows = await this.db
      .select({
        id: tasks.id,
        projectId: tasks.projectId,
        projectKey: taskProjects.key,
        projectName: taskProjects.name,
        seq: tasks.seq,
        title: tasks.title,
        priority: tasks.priority,
        dueAt: tasks.dueAt,
        completedAt: tasks.completedAt,
      })
      .from(tasks)
      .innerJoin(
        taskProjects,
        and(eq(taskProjects.id, tasks.projectId), isNull(taskProjects.deletedAt)),
      )
      // Only tasks in projects the caller belongs to — so every listed card is openable.
      .innerJoin(
        taskProjectMembers,
        and(
          eq(taskProjectMembers.projectId, tasks.projectId),
          eq(taskProjectMembers.userId, actor.id),
        ),
      )
      .where(
        and(
          arrayContains(idColumn, [actor.id]),
          isNull(tasks.deletedAt),
          isNull(tasks.archivedAt),
          isNull(tasks.completedAt),
        ),
      )
      .orderBy(asc(tasks.dueAt));
    return rows.map((r) => ({
      id: r.id,
      projectId: r.projectId,
      projectKey: r.projectKey,
      projectName: r.projectName,
      seq: r.seq,
      title: r.title,
      priority: r.priority,
      dueAt: r.dueAt?.toISOString() ?? null,
      completedAt: r.completedAt?.toISOString() ?? null,
    }));
  }

  /** Count of the caller's assigned active tasks whose due day has already passed (sidebar badge). */
  async overdueCount(actor: AuthUser): Promise<number> {
    const [row] = await this.db
      .select({ n: count() })
      .from(tasks)
      .innerJoin(
        taskProjectMembers,
        and(
          eq(taskProjectMembers.projectId, tasks.projectId),
          eq(taskProjectMembers.userId, actor.id),
        ),
      )
      .where(
        and(
          arrayContains(tasks.assigneeIds, [actor.id]),
          isNull(tasks.deletedAt),
          isNull(tasks.archivedAt),
          isNull(tasks.completedAt),
          isNotNull(tasks.dueAt),
          lt(tasks.dueAt, dushanbeTodayStart()),
        ),
      );
    return Number(row?.n ?? 0);
  }

  private async notifyAssigned(card: TaskRow, userIds: string[], actor: AuthUser): Promise<void> {
    const recipients = await this.membersAmong(
      card.projectId,
      userIds.filter((id) => id !== actor.id),
    );
    if (!recipients.length) return;
    const cardNo = await this.cardNumber(card);
    void this.notifications.notifyMany({
      userIds: recipients,
      type: 'tasks.card.assigned',
      title: `Вам назначена задача ${cardNo}`,
      body: card.title,
      entityType: 'task',
      entityId: card.id,
      priority: 'normal',
      emailMode: 'offline',
    });
  }

  private async notifyStatusChange(
    card: TaskRow,
    column: ColumnRow,
    actor: AuthUser,
  ): Promise<void> {
    // Watchers may include non-members (an editor can set watcherIds, or a removed member's id
    // lingers) — filter to current members so a private card's title never leaks.
    const watchers = await this.membersAmong(
      card.projectId,
      card.watcherIds.filter((id) => id !== actor.id),
    );
    if (!watchers.length) return;
    const cardNo = await this.cardNumber(card);
    void this.notifications.notifyMany({
      userIds: watchers,
      type: 'tasks.card.status_changed',
      title: `Статус задачи ${cardNo}: ${column.name}`,
      body: card.title,
      entityType: 'task',
      entityId: card.id,
      priority: 'normal',
      emailMode: 'offline',
    });
  }

  private async membersAmong(projectId: string, userIds: string[]): Promise<string[]> {
    if (!userIds.length) return [];
    const rows = await this.db
      .select({ userId: taskProjectMembers.userId })
      .from(taskProjectMembers)
      .where(
        and(
          eq(taskProjectMembers.projectId, projectId),
          inArray(taskProjectMembers.userId, userIds),
        ),
      );
    return rows.map((r) => r.userId);
  }

  private async cardNumber(card: TaskRow): Promise<string> {
    const [project] = await this.db
      .select({ key: taskProjects.key })
      .from(taskProjects)
      .where(eq(taskProjects.id, card.projectId))
      .limit(1);
    return `${project?.key ?? '—'}-${card.seq}`;
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

  private cardDto(
    c: TaskRow,
    counts: { done: number; total: number } | undefined,
    commentCount = 0,
  ): TaskCardDto {
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
      commentCount,
      completedAt: c.completedAt?.toISOString() ?? null,
      archivedAt: c.archivedAt?.toISOString() ?? null,
    };
  }

  private async commentCounts(taskIds: string[]): Promise<Map<string, number>> {
    if (!taskIds.length) return new Map();
    const rows = await this.db
      .select({ taskId: comments.entityId, total: count() })
      .from(comments)
      .where(
        and(
          eq(comments.entityType, 'task'),
          inArray(comments.entityId, taskIds),
          isNull(comments.deletedAt),
        ),
      )
      .groupBy(comments.entityId);
    return new Map(rows.map((r) => [r.taskId, Number(r.total)]));
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

  private requireCardWithRole(taskId: string, actor: AuthUser, min: ProjectRole): Promise<TaskRow> {
    return this.acl.loadCardWithRole(taskId, actor, min);
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

/** Whether two id lists hold the same set (order- and duplicate-insensitive). */
function sameSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(b);
  return a.every((x) => set.has(x));
}

const DUSHANBE_OFFSET_MS = 5 * 60 * 60 * 1000;

/** The UTC instant of the current Asia/Dushanbe calendar day's 00:00 — anything due before it is
 *  overdue by whole local days (matches shared `taskDueBucket`). */
function dushanbeTodayStart(): Date {
  const day = Math.floor((Date.now() + DUSHANBE_OFFSET_MS) / 86_400_000);
  return new Date(day * 86_400_000 - DUSHANBE_OFFSET_MS);
}
