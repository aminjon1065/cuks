import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq } from 'drizzle-orm';
import { taskChecklistItems, type Database } from '@cuks/db';
import {
  keyBetween,
  wsRooms,
  type ChecklistItemDto,
  type CreateChecklistItemInput,
  type UpdateChecklistItemInput,
} from '@cuks/shared';
import type { AuthUser } from '../../common/auth/auth-user';
import { AppException } from '../../common/exceptions/app.exception';
import { DB } from '../../common/db/db.module';
import { RealtimeService } from '../events/realtime.service';
import { TasksAclService } from './tasks-acl.service';

type ChecklistRow = typeof taskChecklistItems.$inferSelect;

/** A card's checklist (docs/modules/15 §4, task 4.3). Items are fractionally ordered so a reorder
 *  rewrites only the moved row; editing needs `editor`. Every change refreshes the card. */
@Injectable()
export class ChecklistService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly acl: TasksAclService,
    private readonly realtime: RealtimeService,
  ) {}

  async list(taskId: string): Promise<ChecklistItemDto[]> {
    const rows = await this.db
      .select()
      .from(taskChecklistItems)
      .where(eq(taskChecklistItems.taskId, taskId))
      .orderBy(asc(taskChecklistItems.orderKey));
    return rows.map((r) => this.toDto(r));
  }

  async add(
    taskId: string,
    input: CreateChecklistItemInput,
    actor: AuthUser,
  ): Promise<ChecklistItemDto[]> {
    const card = await this.acl.loadCardWithRole(taskId, actor, 'editor');
    const [last] = await this.db
      .select({ orderKey: taskChecklistItems.orderKey })
      .from(taskChecklistItems)
      .where(eq(taskChecklistItems.taskId, taskId))
      .orderBy(desc(taskChecklistItems.orderKey))
      .limit(1);
    await this.db.insert(taskChecklistItems).values({
      taskId,
      text: input.text,
      orderKey: keyBetween(last?.orderKey ?? null, null),
    });
    this.emitUpdated(card.projectId, taskId, actor.id);
    return this.list(taskId);
  }

  async update(
    taskId: string,
    itemId: string,
    input: UpdateChecklistItemInput,
    actor: AuthUser,
  ): Promise<ChecklistItemDto[]> {
    const card = await this.acl.loadCardWithRole(taskId, actor, 'editor');
    await this.requireItem(taskId, itemId);
    const set: Partial<ChecklistRow> = {};
    if (input.text !== undefined) set.text = input.text;
    if (input.isDone !== undefined) set.isDone = input.isDone;
    if (input.afterItemId !== undefined) {
      const [before, after] = await this.neighbourKeys(taskId, input.afterItemId, itemId);
      set.orderKey = keyBetween(before, after);
    }
    await this.db.update(taskChecklistItems).set(set).where(eq(taskChecklistItems.id, itemId));
    this.emitUpdated(card.projectId, taskId, actor.id);
    return this.list(taskId);
  }

  async remove(taskId: string, itemId: string, actor: AuthUser): Promise<ChecklistItemDto[]> {
    const card = await this.acl.loadCardWithRole(taskId, actor, 'editor');
    await this.requireItem(taskId, itemId);
    await this.db.delete(taskChecklistItems).where(eq(taskChecklistItems.id, itemId));
    this.emitUpdated(card.projectId, taskId, actor.id);
    return this.list(taskId);
  }

  private async requireItem(taskId: string, itemId: string): Promise<void> {
    const [item] = await this.db
      .select({ id: taskChecklistItems.id })
      .from(taskChecklistItems)
      .where(and(eq(taskChecklistItems.id, itemId), eq(taskChecklistItems.taskId, taskId)))
      .limit(1);
    if (!item) throw AppException.notFound('tasks.checklist.not_found', 'Checklist item not found');
  }

  /** Order keys bracketing the slot after `afterItemId` (null = top), excluding the moved item. */
  private async neighbourKeys(
    taskId: string,
    afterItemId: string | null,
    excludeId: string,
  ): Promise<[string | null, string | null]> {
    const items = (
      await this.db
        .select({ id: taskChecklistItems.id, orderKey: taskChecklistItems.orderKey })
        .from(taskChecklistItems)
        .where(eq(taskChecklistItems.taskId, taskId))
        .orderBy(asc(taskChecklistItems.orderKey))
    ).filter((i) => i.id !== excludeId);
    if (afterItemId === null) return [null, items[0]?.orderKey ?? null];
    const idx = items.findIndex((i) => i.id === afterItemId);
    if (idx === -1)
      throw AppException.notFound('tasks.checklist.not_found', 'Checklist item not found');
    return [items[idx]!.orderKey, items[idx + 1]?.orderKey ?? null];
  }

  private emitUpdated(projectId: string, taskId: string, actorId: string): void {
    this.realtime.emitToRoom(wsRooms.board(projectId), 'tasks.card.updated', {
      projectId,
      taskId,
      actorId,
    });
  }

  private toDto(r: ChecklistRow): ChecklistItemDto {
    return { id: r.id, text: r.text, isDone: r.isDone, orderKey: r.orderKey };
  }
}
