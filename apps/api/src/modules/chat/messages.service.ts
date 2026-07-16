import { Inject, Injectable } from '@nestjs/common';
import { aliasedTable, and, asc, count, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  chatChannels,
  chatMessages,
  chatPins,
  chatReactions,
  users,
  type Database,
} from '@cuks/db';
import {
  CHAT_MESSAGE_MAX_CHARS,
  tiptapPlainText,
  wsRooms,
  type EditMessageInput,
  type MessageDto,
  type MessagesPage,
  type MessagesQuery,
  type PinnedMessageDto,
  type ReactionSummaryDto,
  type ReplySnippetDto,
  type SendMessageInput,
} from '@cuks/shared';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthUser } from '../../common/auth/auth-user';
import { AppException } from '../../common/exceptions/app.exception';
import { DB } from '../../common/db/db.module';
import { RealtimeService } from '../events/realtime.service';
import { CHANNEL_ROLE_RANK, ChatAclService } from './chat-acl.service';
import { decodeCursor, encodeCursor } from './cursor';

type MessageRow = typeof chatMessages.$inferSelect;
type MessageSelect = MessageRow & { authorName: string | null };

/** Editing one's own message is allowed for 24 hours (docs/modules/13 §4). */
const EDIT_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Message history, sending and the 5.5 message actions (docs/modules/13 §3–§5): cursor-paginated
 * history with reactions + reply snippets, edit (author, ≤24h), soft delete (author or channel
 * admin+), palette-restricted reaction toggling and the pinned-messages panel.
 */
@Injectable()
export class MessagesService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly acl: ChatAclService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
  ) {}

  /** A page of messages, newest first, with a cursor for the next older page. When `around` is set,
   *  returns a window centered on that message instead (jump-to-message context). */
  async list(channelId: string, query: MessagesQuery, actor: AuthUser): Promise<MessagesPage> {
    await this.acl.requireMember(channelId, actor);
    if (query.around) return this.listAround(channelId, query.around, query.limit, actor);
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
    const pageRows = hasMore ? rows.slice(0, query.limit) : rows;
    const ids = pageRows.map((r) => r.msg.id);
    const replyIds = [
      ...new Set(pageRows.map((r) => r.msg.replyToId).filter((v): v is string => !!v)),
    ];
    const [reactions, replies] = await Promise.all([
      this.reactionSummaries(ids, actor.id),
      this.replySnippets(channelId, replyIds),
    ]);

    const page = pageRows.map((r) =>
      this.toDto(
        { ...r.msg, authorName: r.authorName },
        reactions.get(r.msg.id) ?? [],
        r.msg.replyToId ? (replies.get(r.msg.replyToId) ?? null) : null,
      ),
    );
    const oldest = page[page.length - 1];
    return {
      items: page,
      nextCursor: hasMore && oldest ? encodeCursor(oldest.createdAt, oldest.id) : null,
    };
  }

  /** A window centered on `targetId` (docs/modules/13 §4 jump-to-message): the target plus roughly
   *  half a page of newer and half of older messages, newest first, with an older cursor. */
  private async listAround(
    channelId: string,
    targetId: string,
    limit: number,
    actor: AuthUser,
  ): Promise<MessagesPage> {
    const author = aliasedTable(users, 'chat_msg_author');
    const [target] = await this.db
      .select({ createdAt: chatMessages.createdAt, id: chatMessages.id })
      .from(chatMessages)
      .where(and(eq(chatMessages.id, targetId), eq(chatMessages.channelId, channelId)))
      .limit(1);
    if (!target) throw AppException.notFound('chat.message.not_found', 'Message not found');
    const half = Math.max(1, Math.floor(limit / 2));

    const select = () =>
      this.db.select({ msg: chatMessages, authorName: author.shortName }).from(chatMessages);
    const [olderOrEqual, newer] = await Promise.all([
      // The target and everything older, newest first — one extra to detect a further older page.
      select()
        .leftJoin(author, eq(author.id, chatMessages.authorId))
        .where(
          and(
            eq(chatMessages.channelId, channelId),
            sql`(${chatMessages.createdAt}, ${chatMessages.id}) <= (${target.createdAt}, ${target.id})`,
          ),
        )
        .orderBy(desc(chatMessages.createdAt), desc(chatMessages.id))
        .limit(half + 2),
      // Strictly newer than the target, oldest first (so it abuts the target).
      select()
        .leftJoin(author, eq(author.id, chatMessages.authorId))
        .where(
          and(
            eq(chatMessages.channelId, channelId),
            sql`(${chatMessages.createdAt}, ${chatMessages.id}) > (${target.createdAt}, ${target.id})`,
          ),
        )
        .orderBy(asc(chatMessages.createdAt), asc(chatMessages.id))
        .limit(half),
    ]);

    const hasMoreOlder = olderOrEqual.length > half + 1;
    const olderRows = hasMoreOlder ? olderOrEqual.slice(0, half + 1) : olderOrEqual;
    // Newest first overall: newer (desc) then the target+older run.
    const windowRows = [...newer.reverse(), ...olderRows];
    const items = await this.enrich(channelId, windowRows, actor.id);
    const oldest = items[items.length - 1];
    return {
      items,
      nextCursor: hasMoreOlder && oldest ? encodeCursor(oldest.createdAt, oldest.id) : null,
    };
  }

  /** Attach reaction summaries + reply snippets to a set of message rows, preserving order. */
  private async enrich(
    channelId: string,
    rows: { msg: MessageRow; authorName: string | null }[],
    userId: string,
  ): Promise<MessageDto[]> {
    const ids = rows.map((r) => r.msg.id);
    const replyIds = [...new Set(rows.map((r) => r.msg.replyToId).filter((v): v is string => !!v))];
    const [reactions, replies] = await Promise.all([
      this.reactionSummaries(ids, userId),
      this.replySnippets(channelId, replyIds),
    ]);
    return rows.map((r) =>
      this.toDto(
        { ...r.msg, authorName: r.authorName },
        reactions.get(r.msg.id) ?? [],
        r.msg.replyToId ? (replies.get(r.msg.replyToId) ?? null) : null,
      ),
    );
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
    const bodyText = body ? this.extractText(body) : null;

    // A reply must reference a live message of the SAME channel — otherwise a crafted replyToId
    // could pull a snippet out of a channel the sender can't read.
    let replyTo: ReplySnippetDto | null = null;
    if (input.replyToId) {
      const snippets = await this.replySnippets(channelId, [input.replyToId]);
      replyTo = snippets.get(input.replyToId) ?? null;
      if (!replyTo || replyTo.deleted) {
        throw AppException.badRequest('chat.reply.not_found', 'Replied-to message not found');
      }
    }

    const now = new Date();
    const [row] = await this.db
      .insert(chatMessages)
      .values({
        channelId,
        authorId: actor.id,
        kind: input.kind,
        body,
        bodyText,
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
    return this.toDto({ ...row!, authorName: actor.shortName }, [], replyTo);
  }

  /** Edit one's own text message within 24 hours (docs/modules/13 §4) — «изменено» mark via editedAt. */
  async edit(messageId: string, input: EditMessageInput, actor: AuthUser): Promise<MessageDto> {
    const msg = await this.loadMessage(messageId);
    await this.acl.requireMember(msg.channelId, actor);
    if (msg.authorId !== actor.id) {
      throw AppException.forbidden('chat.message.not_author', 'Only the author may edit');
    }
    if (msg.kind !== 'text') {
      throw AppException.badRequest('chat.message.not_editable', 'Only text messages are editable');
    }
    if (Date.now() - msg.createdAt.getTime() > EDIT_WINDOW_MS) {
      throw AppException.forbidden('chat.message.edit_expired', 'The 24h edit window has passed');
    }
    const body = input.body ?? null;
    if (!body) throw AppException.badRequest('chat.message.empty', 'A text message needs a body');
    const bodyText = this.extractText(body);

    const now = new Date();
    await this.db
      .update(chatMessages)
      .set({ body, bodyText, editedAt: now })
      .where(eq(chatMessages.id, messageId));
    this.realtime.emitToRoom(wsRooms.channel(msg.channelId), 'chat.message.updated', {
      channelId: msg.channelId,
      messageId,
      actorId: actor.id,
    });
    this.audit.log({
      action: 'chat.message.updated',
      actorId: actor.id,
      entityType: 'chat_channel',
      entityId: msg.channelId,
      meta: { messageId },
    });
    const reactions = await this.reactionSummaries([messageId], actor.id);
    return this.toDto(
      { ...msg, body, bodyText, editedAt: now, authorName: actor.shortName },
      reactions.get(messageId) ?? [],
      null,
    );
  }

  /** Soft-delete: the author may delete their own message, a channel admin+ any (docs/modules/13 §4).
   *  The row stays (state archive retention, §9) and renders as a tombstone. */
  async remove(messageId: string, actor: AuthUser): Promise<void> {
    const msg = await this.loadMessage(messageId);
    await this.acl.requireMember(msg.channelId, actor);
    if (msg.authorId !== actor.id) {
      const role = await this.acl.roleFor(msg.channelId, actor.id);
      if (!role || CHANNEL_ROLE_RANK[role] < CHANNEL_ROLE_RANK.admin) {
        throw AppException.forbidden('chat.message.not_author', 'Only the author or an admin');
      }
    }
    await this.db
      .update(chatMessages)
      .set({ deletedAt: new Date() })
      .where(eq(chatMessages.id, messageId));
    this.realtime.emitToRoom(wsRooms.channel(msg.channelId), 'chat.message.deleted', {
      channelId: msg.channelId,
      messageId,
      actorId: actor.id,
    });
    this.audit.log({
      action: 'chat.message.deleted',
      actorId: actor.id,
      entityType: 'chat_channel',
      entityId: msg.channelId,
      meta: { messageId, authorId: msg.authorId },
    });
  }

  /** Toggle the caller's reaction (palette-validated at the schema): add if absent, remove if set. */
  async toggleReaction(messageId: string, emoji: string, actor: AuthUser): Promise<void> {
    const msg = await this.loadMessage(messageId);
    await this.acl.requireMember(msg.channelId, actor);
    const inserted = await this.db
      .insert(chatReactions)
      .values({ messageId, userId: actor.id, emoji })
      .onConflictDoNothing({
        target: [chatReactions.messageId, chatReactions.userId, chatReactions.emoji],
      })
      .returning({ id: chatReactions.id });
    if (inserted.length === 0) {
      await this.db
        .delete(chatReactions)
        .where(
          and(
            eq(chatReactions.messageId, messageId),
            eq(chatReactions.userId, actor.id),
            eq(chatReactions.emoji, emoji),
          ),
        );
    }
    this.realtime.emitToRoom(wsRooms.channel(msg.channelId), 'chat.reaction.updated', {
      channelId: msg.channelId,
      messageId,
      actorId: actor.id,
    });
  }

  /** The channel's pinned messages, newest pin first (docs/modules/13 §4/§7). */
  async listPins(channelId: string, actor: AuthUser): Promise<PinnedMessageDto[]> {
    await this.acl.requireMember(channelId, actor);
    const author = aliasedTable(users, 'chat_pin_author');
    const pinner = aliasedTable(users, 'chat_pin_by');
    const rows = await this.db
      .select({
        messageId: chatPins.messageId,
        authorName: author.shortName,
        bodyText: chatMessages.bodyText,
        createdAt: chatMessages.createdAt,
        pinnedByName: pinner.shortName,
        pinnedAt: chatPins.createdAt,
      })
      .from(chatPins)
      .innerJoin(
        chatMessages,
        and(eq(chatMessages.id, chatPins.messageId), isNull(chatMessages.deletedAt)),
      )
      .leftJoin(author, eq(author.id, chatMessages.authorId))
      .leftJoin(pinner, eq(pinner.id, chatPins.pinnedBy))
      .where(eq(chatPins.channelId, channelId))
      .orderBy(desc(chatPins.createdAt));
    return rows.map((r) => ({
      messageId: r.messageId,
      authorName: r.authorName ?? null,
      bodyText: r.bodyText,
      createdAt: r.createdAt.toISOString(),
      pinnedByName: r.pinnedByName ?? null,
      pinnedAt: r.pinnedAt.toISOString(),
    }));
  }

  /** Pin a message to the channel panel — admin+ curation (decision in docs/plan/STATUS.md). */
  async pin(channelId: string, messageId: string, actor: AuthUser): Promise<void> {
    await this.acl.requireMember(channelId, actor, 'admin');
    const msg = await this.loadMessage(messageId);
    if (msg.channelId !== channelId || msg.deletedAt) {
      throw AppException.badRequest('chat.pin.not_found', 'Message not found in this channel');
    }
    await this.db
      .insert(chatPins)
      .values({ channelId, messageId, pinnedBy: actor.id })
      .onConflictDoNothing({ target: [chatPins.channelId, chatPins.messageId] });
    this.audit.log({
      action: 'chat.pin.added',
      actorId: actor.id,
      entityType: 'chat_channel',
      entityId: channelId,
      meta: { messageId },
    });
    this.realtime.emitToRoom(wsRooms.channel(channelId), 'chat.channel.updated', {
      channelId,
      actorId: actor.id,
    });
  }

  async unpin(channelId: string, messageId: string, actor: AuthUser): Promise<void> {
    await this.acl.requireMember(channelId, actor, 'admin');
    await this.db
      .delete(chatPins)
      .where(and(eq(chatPins.channelId, channelId), eq(chatPins.messageId, messageId)));
    this.audit.log({
      action: 'chat.pin.removed',
      actorId: actor.id,
      entityType: 'chat_channel',
      entityId: channelId,
      meta: { messageId },
    });
    this.realtime.emitToRoom(wsRooms.channel(channelId), 'chat.channel.updated', {
      channelId,
      actorId: actor.id,
    });
  }

  // --- helpers ---

  /** Plain text of a body, enforcing the ≤4000-char ceiling (docs/modules/13 §3). */
  private extractText(body: unknown): string {
    const text = tiptapPlainText(body);
    if (text.length > CHAT_MESSAGE_MAX_CHARS) {
      throw AppException.badRequest('chat.message.too_long', 'Message exceeds 4000 characters');
    }
    return text;
  }

  private async loadMessage(messageId: string): Promise<MessageRow> {
    const [row] = await this.db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.id, messageId))
      .limit(1);
    if (!row || row.deletedAt) {
      throw AppException.notFound('chat.message.not_found', 'Message not found');
    }
    return row;
  }

  /** Per-message reaction chips in first-reaction order, with the caller's own flag. */
  private async reactionSummaries(
    messageIds: string[],
    userId: string,
  ): Promise<Map<string, ReactionSummaryDto[]>> {
    if (messageIds.length === 0) return new Map();
    const rows = await this.db
      .select({
        messageId: chatReactions.messageId,
        emoji: chatReactions.emoji,
        n: count(),
        mine: sql<boolean>`bool_or(${chatReactions.userId} = ${userId})`,
        first: sql<string>`min(${chatReactions.createdAt})`,
      })
      .from(chatReactions)
      .where(inArray(chatReactions.messageId, messageIds))
      .groupBy(chatReactions.messageId, chatReactions.emoji)
      .orderBy(sql`min(${chatReactions.createdAt})`);
    const map = new Map<string, ReactionSummaryDto[]>();
    for (const r of rows) {
      const list = map.get(r.messageId) ?? [];
      list.push({ emoji: r.emoji, count: Number(r.n), mine: r.mine });
      map.set(r.messageId, list);
    }
    return map;
  }

  /** Quote snippets for replied-to messages — constrained to the channel so a foreign id renders
   *  nothing rather than leaking another channel's text. */
  private async replySnippets(
    channelId: string,
    replyIds: string[],
  ): Promise<Map<string, ReplySnippetDto>> {
    if (replyIds.length === 0) return new Map();
    const author = aliasedTable(users, 'chat_reply_author');
    const rows = await this.db
      .select({
        id: chatMessages.id,
        authorName: author.shortName,
        bodyText: chatMessages.bodyText,
        deletedAt: chatMessages.deletedAt,
      })
      .from(chatMessages)
      .leftJoin(author, eq(author.id, chatMessages.authorId))
      .where(and(inArray(chatMessages.id, replyIds), eq(chatMessages.channelId, channelId)));
    return new Map(
      rows.map((r) => [
        r.id,
        {
          id: r.id,
          authorName: r.authorName ?? null,
          bodyText: r.deletedAt ? null : r.bodyText,
          deleted: !!r.deletedAt,
        },
      ]),
    );
  }

  private toDto(
    r: MessageSelect,
    reactions: ReactionSummaryDto[],
    replyTo: ReplySnippetDto | null,
  ): MessageDto {
    return {
      id: r.id,
      channelId: r.channelId,
      authorId: r.authorId,
      authorName: r.authorName,
      kind: r.kind,
      body: r.deletedAt ? null : (r.body ?? null),
      bodyText: r.deletedAt ? null : r.bodyText,
      replyToId: r.replyToId,
      replyTo,
      reactions,
      fileIds: r.fileIds,
      createdAt: r.createdAt.toISOString(),
      editedAt: r.editedAt?.toISOString() ?? null,
      deletedAt: r.deletedAt?.toISOString() ?? null,
    };
  }
}
