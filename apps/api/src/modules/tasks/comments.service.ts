import { Inject, Injectable } from '@nestjs/common';
import { aliasedTable, and, asc, eq, inArray, isNull } from 'drizzle-orm';
import {
  comments,
  taskActivity,
  taskProjectMembers,
  taskProjects,
  users,
  type Database,
} from '@cuks/db';
import { truncateSafe, wsRooms, type CommentDto, type CreateCommentInput } from '@cuks/shared';
import type { AuthUser } from '../../common/auth/auth-user';
import { AppException } from '../../common/exceptions/app.exception';
import { DB } from '../../common/db/db.module';
import { RealtimeService } from '../events/realtime.service';
import { NotificationsService } from '../notifications/notifications.service';
import { TasksAclService } from './tasks-acl.service';

const ENTITY = 'task';

/** Card comments with @-mentions (docs/modules/15 §4/§7, task 4.3). Any project viewer may comment;
 *  mentioned project members are notified. Mentions of non-members are recorded but not notified, so
 *  a private card's content never reaches someone who cannot open it. */
@Injectable()
export class TaskCommentsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly acl: TasksAclService,
    private readonly realtime: RealtimeService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(taskId: string, actor: AuthUser): Promise<CommentDto[]> {
    await this.acl.loadCardWithRole(taskId, actor, 'viewer');
    const author = aliasedTable(users, 'comment_author');
    const rows = await this.db
      .select({
        id: comments.id,
        authorId: comments.authorId,
        authorName: author.shortName,
        body: comments.body,
        mentions: comments.mentions,
        createdAt: comments.createdAt,
        updatedAt: comments.updatedAt,
      })
      .from(comments)
      .leftJoin(author, eq(author.id, comments.authorId))
      .where(
        and(
          eq(comments.entityType, ENTITY),
          eq(comments.entityId, taskId),
          isNull(comments.deletedAt),
        ),
      )
      .orderBy(asc(comments.createdAt));
    return rows.map((r) => this.toDto(r));
  }

  async add(taskId: string, input: CreateCommentInput, actor: AuthUser): Promise<CommentDto> {
    const card = await this.acl.loadCardWithRole(taskId, actor, 'viewer');
    const mentions = [...new Set(input.mentionIds)];
    const [row] = await this.db
      .insert(comments)
      .values({
        entityType: ENTITY,
        entityId: taskId,
        authorId: actor.id,
        body: input.body,
        mentions,
      })
      .returning();
    await this.db.insert(taskActivity).values({
      taskId,
      actorId: actor.id,
      action: 'tasks.card.commented',
      meta: { commentId: row!.id },
    });
    this.realtime.emitToRoom(wsRooms.board(card.projectId), 'tasks.card.updated', {
      projectId: card.projectId,
      taskId,
      actorId: actor.id,
    });
    await this.notifyMentions(card.projectId, taskId, card.seq, mentions, input.body, actor);
    return this.reload(row!.id);
  }

  async remove(taskId: string, commentId: string, actor: AuthUser): Promise<void> {
    const card = await this.acl.loadCardWithRole(taskId, actor, 'viewer');
    const [row] = await this.db
      .select({ authorId: comments.authorId })
      .from(comments)
      .where(
        and(
          eq(comments.id, commentId),
          eq(comments.entityType, ENTITY),
          eq(comments.entityId, taskId),
          isNull(comments.deletedAt),
        ),
      )
      .limit(1);
    if (!row) throw AppException.notFound('tasks.comment.not_found', 'Comment not found');
    // Only the author may delete their own comment (a project owner may moderate).
    const role = await this.acl.roleFor(card.projectId, actor.id);
    if (row.authorId !== actor.id && role !== 'owner' && !actor.isSuperadmin) {
      throw AppException.forbidden('tasks.comment.forbidden', 'Not your comment');
    }
    await this.db
      .update(comments)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(comments.id, commentId));
    this.realtime.emitToRoom(wsRooms.board(card.projectId), 'tasks.card.updated', {
      projectId: card.projectId,
      taskId,
      actorId: actor.id,
    });
  }

  /** Notify @-mentioned users who are members of the project (so a private card never leaks). */
  private async notifyMentions(
    projectId: string,
    taskId: string,
    seq: number,
    mentionIds: string[],
    body: string,
    actor: AuthUser,
  ): Promise<void> {
    const targets = mentionIds.filter((id) => id !== actor.id);
    if (targets.length === 0) return;
    const members = await this.db
      .select({ userId: taskProjectMembers.userId })
      .from(taskProjectMembers)
      .where(
        and(
          eq(taskProjectMembers.projectId, projectId),
          inArray(taskProjectMembers.userId, targets),
        ),
      );
    const recipients = members.map((m) => m.userId);
    if (recipients.length === 0) return;
    const [project] = await this.db
      .select({ key: taskProjects.key })
      .from(taskProjects)
      .where(eq(taskProjects.id, projectId))
      .limit(1);
    const cardNo = `${project?.key ?? '—'}-${seq}`;
    void this.notifications.notifyMany({
      userIds: recipients,
      type: 'tasks.comment.mention',
      title: `Упоминание в задаче ${cardNo}`,
      body: `${actor.shortName}: ${truncateSafe(body, 140)}`,
      entityType: 'task',
      entityId: taskId,
      priority: 'normal',
      emailMode: 'offline',
    });
  }

  private async reload(commentId: string): Promise<CommentDto> {
    const author = aliasedTable(users, 'comment_author2');
    const [row] = await this.db
      .select({
        id: comments.id,
        authorId: comments.authorId,
        authorName: author.shortName,
        body: comments.body,
        mentions: comments.mentions,
        createdAt: comments.createdAt,
        updatedAt: comments.updatedAt,
      })
      .from(comments)
      .leftJoin(author, eq(author.id, comments.authorId))
      .where(eq(comments.id, commentId))
      .limit(1);
    return this.toDto(row!);
  }

  private toDto(r: {
    id: string;
    authorId: string;
    authorName: string | null;
    body: string;
    mentions: string[];
    createdAt: Date;
    updatedAt: Date;
  }): CommentDto {
    return {
      id: r.id,
      authorId: r.authorId,
      authorName: r.authorName,
      body: r.body,
      mentions: r.mentions,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  }
}
