import { Inject, Injectable } from '@nestjs/common';
import { aliasedTable, and, desc, eq, sql } from 'drizzle-orm';
import { chatChannels, chatMessages, users, type Database } from '@cuks/db';
import {
  tiptapPlainText,
  wsRooms,
  type MessageDto,
  type MessagesPage,
  type MessagesQuery,
  type SendMessageInput,
} from '@cuks/shared';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthUser } from '../../common/auth/auth-user';
import { AppException } from '../../common/exceptions/app.exception';
import { DB } from '../../common/db/db.module';
import { RealtimeService } from '../events/realtime.service';
import { ChatAclService } from './chat-acl.service';

type MessageRow = typeof chatMessages.$inferSelect;
type MessageSelect = MessageRow & { authorName: string | null };

/** Message history + sending (docs/modules/13 §3/§5, task 5.2). History is cursor-paginated upward
 *  (newest first); sending bumps the channel's `last_message_at` and broadcasts to its room. */
@Injectable()
export class MessagesService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly acl: ChatAclService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
  ) {}

  /** A page of messages, newest first, with a cursor for the next older page. */
  async list(channelId: string, query: MessagesQuery, actor: AuthUser): Promise<MessagesPage> {
    await this.acl.requireMember(channelId, actor);
    const author = aliasedTable(users, 'chat_msg_author');
    const before = query.cursor ? decodeCursor(query.cursor) : null;
    const rows = await this.db
      .select({ msg: chatMessages, authorName: author.shortName })
      .from(chatMessages)
      .leftJoin(author, eq(author.id, chatMessages.authorId))
      .where(
        and(
          eq(chatMessages.channelId, channelId),
          before
            ? sql`(${chatMessages.createdAt}, ${chatMessages.id}) < (${before.createdAt}, ${before.id})`
            : undefined,
        ),
      )
      .orderBy(desc(chatMessages.createdAt), desc(chatMessages.id))
      .limit(query.limit + 1);

    const hasMore = rows.length > query.limit;
    const page = (hasMore ? rows.slice(0, query.limit) : rows).map((r) =>
      this.toDto({ ...r.msg, authorName: r.authorName }),
    );
    const oldest = page[page.length - 1];
    return {
      items: page,
      nextCursor: hasMore && oldest ? encodeCursor(oldest.createdAt, oldest.id) : null,
    };
  }

  async send(channelId: string, input: SendMessageInput, actor: AuthUser): Promise<MessageDto> {
    await this.acl.requireMember(channelId, actor);
    const body = input.body ?? null;
    if (input.kind === 'text' && !body) {
      throw AppException.badRequest('chat.message.empty', 'A text message needs a body');
    }
    if (input.kind === 'file' && input.fileIds.length === 0) {
      throw AppException.badRequest('chat.message.no_files', 'A file message needs files');
    }
    const now = new Date();
    const [row] = await this.db
      .insert(chatMessages)
      .values({
        channelId,
        authorId: actor.id,
        kind: input.kind,
        body,
        bodyText: body ? tiptapPlainText(body) : null,
        replyToId: input.replyToId ?? null,
        fileIds: input.fileIds,
        createdAt: now,
      })
      .returning();
    await this.db
      .update(chatChannels)
      .set({ lastMessageAt: now, updatedAt: now })
      .where(eq(chatChannels.id, channelId));
    this.realtime.emitToRoom(wsRooms.channel(channelId), 'chat.message.created', {
      channelId,
      messageId: row!.id,
      actorId: actor.id,
    });
    this.audit.log({
      action: 'chat.message.created',
      actorId: actor.id,
      entityType: 'chat_channel',
      entityId: channelId,
      meta: { messageId: row!.id },
    });
    return this.toDto({ ...row!, authorName: actor.shortName });
  }

  private toDto(r: MessageSelect): MessageDto {
    return {
      id: r.id,
      channelId: r.channelId,
      authorId: r.authorId,
      authorName: r.authorName,
      kind: r.kind,
      body: r.body ?? null,
      bodyText: r.bodyText,
      replyToId: r.replyToId,
      fileIds: r.fileIds,
      createdAt: r.createdAt.toISOString(),
      editedAt: r.editedAt?.toISOString() ?? null,
      deletedAt: r.deletedAt?.toISOString() ?? null,
    };
  }
}

/** Cursor = base64 of `<createdAt ISO>|<id>` — a stable (created_at, id) anchor for keyset paging. */
function encodeCursor(createdAtIso: string, id: string): string {
  return Buffer.from(`${createdAtIso}|${id}`).toString('base64url');
}
function decodeCursor(cursor: string): { createdAt: Date; id: string } {
  const [iso, id] = Buffer.from(cursor, 'base64url').toString().split('|');
  if (!iso || !id) throw AppException.badRequest('chat.cursor.invalid', 'Invalid cursor');
  return { createdAt: new Date(iso), id };
}
