import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import { taskColumns, tasks, type Database } from '@cuks/db';
import {
  keyBetween,
  wsRooms,
  type ColumnDto,
  type CreateColumnInput,
  type MoveColumnInput,
  type UpdateColumnInput,
} from '@cuks/shared';
import type { AuthUser } from '../../common/auth/auth-user';
import { AppException } from '../../common/exceptions/app.exception';
import { DB } from '../../common/db/db.module';
import { RealtimeService } from '../events/realtime.service';
import { TasksAclService } from './tasks-acl.service';

type ColumnRow = typeof taskColumns.$inferSelect;

@Injectable()
export class ColumnsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly acl: TasksAclService,
    private readonly realtime: RealtimeService,
  ) {}

  private toDto(c: ColumnRow): ColumnDto {
    return {
      id: c.id,
      name: c.name,
      orderKey: c.orderKey,
      wipLimit: c.wipLimit,
      isDoneColumn: c.isDoneColumn,
    };
  }

  private emit(projectId: string, actorId: string): void {
    this.realtime.emitToRoom(wsRooms.board(projectId), 'tasks.board.changed', {
      projectId,
      actorId,
    });
  }

  async create(projectId: string, input: CreateColumnInput, actor: AuthUser): Promise<ColumnDto> {
    await this.acl.loadWithRole(projectId, actor, 'owner');
    const [last] = await this.db
      .select({ orderKey: taskColumns.orderKey })
      .from(taskColumns)
      .where(and(eq(taskColumns.projectId, projectId), isNull(taskColumns.deletedAt)))
      .orderBy(desc(taskColumns.orderKey))
      .limit(1);
    const [col] = await this.db
      .insert(taskColumns)
      .values({
        projectId,
        name: input.name,
        orderKey: keyBetween(last?.orderKey ?? null, null),
        wipLimit: input.wipLimit ?? null,
        isDoneColumn: input.isDoneColumn,
      })
      .returning();
    this.emit(projectId, actor.id);
    return this.toDto(col!);
  }

  async update(
    projectId: string,
    columnId: string,
    input: UpdateColumnInput,
    actor: AuthUser,
  ): Promise<ColumnDto> {
    await this.acl.loadWithRole(projectId, actor, 'owner');
    const col = await this.requireColumn(projectId, columnId);
    await this.db
      .update(taskColumns)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.wipLimit !== undefined ? { wipLimit: input.wipLimit ?? null } : {}),
        ...(input.isDoneColumn !== undefined ? { isDoneColumn: input.isDoneColumn } : {}),
        updatedAt: new Date(),
      })
      .where(eq(taskColumns.id, col.id));
    this.emit(projectId, actor.id);
    const [updated] = await this.db
      .select()
      .from(taskColumns)
      .where(eq(taskColumns.id, columnId))
      .limit(1);
    return this.toDto(updated!);
  }

  async move(
    projectId: string,
    columnId: string,
    input: MoveColumnInput,
    actor: AuthUser,
  ): Promise<ColumnDto> {
    await this.acl.loadWithRole(projectId, actor, 'owner');
    await this.requireColumn(projectId, columnId);
    const [before, after] = await this.neighbourKeys(projectId, input.afterColumnId, columnId);
    await this.db
      .update(taskColumns)
      .set({ orderKey: keyBetween(before, after), updatedAt: new Date() })
      .where(eq(taskColumns.id, columnId));
    this.emit(projectId, actor.id);
    const [moved] = await this.db
      .select()
      .from(taskColumns)
      .where(eq(taskColumns.id, columnId))
      .limit(1);
    return this.toDto(moved!);
  }

  /** Drop an empty column (soft-delete). A column with cards must be emptied first. */
  async remove(projectId: string, columnId: string, actor: AuthUser): Promise<void> {
    await this.acl.loadWithRole(projectId, actor, 'owner');
    await this.requireColumn(projectId, columnId);
    const [card] = await this.db
      .select({ id: tasks.id })
      .from(tasks)
      .where(and(eq(tasks.columnId, columnId), isNull(tasks.deletedAt), isNull(tasks.archivedAt)))
      .limit(1);
    if (card) {
      throw AppException.badRequest(
        'tasks.column.not_empty',
        'Move the cards out of the column first',
      );
    }
    await this.db
      .update(taskColumns)
      .set({ deletedAt: new Date() })
      .where(eq(taskColumns.id, columnId));
    this.emit(projectId, actor.id);
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

  /** The keys bracketing the target position: (afterColumn.orderKey | null, the next column's
   *  orderKey | null), computed over the live columns excluding the one being moved. */
  private async neighbourKeys(
    projectId: string,
    afterColumnId: string | null,
    excludeId: string,
  ): Promise<[string | null, string | null]> {
    const cols = (
      await this.db
        .select({ id: taskColumns.id, orderKey: taskColumns.orderKey })
        .from(taskColumns)
        .where(and(eq(taskColumns.projectId, projectId), isNull(taskColumns.deletedAt)))
        .orderBy(asc(taskColumns.orderKey))
    ).filter((c) => c.id !== excludeId);
    if (afterColumnId === null) return [null, cols[0]?.orderKey ?? null];
    const idx = cols.findIndex((c) => c.id === afterColumnId);
    if (idx === -1) throw AppException.notFound('tasks.column.not_found', 'Column not found');
    return [cols[idx]!.orderKey, cols[idx + 1]?.orderKey ?? null];
  }
}
