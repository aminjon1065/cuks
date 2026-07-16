import { Inject, Injectable } from '@nestjs/common';
import { aliasedTable, and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { chatChannels, chatMembers, chatMessages, users, type Database } from '@cuks/db';
import type { ChatSearchPage, ChatSearchQuery, ChatSearchResultDto } from '@cuks/shared';
import type { AuthUser } from '../../common/auth/auth-user';
import { DB } from '../../common/db/db.module';
import { ChatAclService } from './chat-acl.service';
import { decodeCursor, encodeCursor } from './cursor';

/** Rolling window (from now) each period covers. */
const PERIOD_DAYS: Record<Exclude<ChatSearchQuery['period'], 'all'>, number> = {
  today: 1,
  week: 7,
  month: 30,
};

/**
 * Full-text search over chat messages (docs/modules/13 §4/§8). Scoped to the caller's member channels
 * (a private channel a non-member can't read never appears), with optional filters by channel, author
 * and period. Ranked by recency and keyset-paginated on `(created_at, id)` like the feed.
 */
@Injectable()
export class ChatSearchService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly acl: ChatAclService,
  ) {}

  async search(query: ChatSearchQuery, actor: AuthUser): Promise<ChatSearchPage> {
    // A channel filter must be one the caller can read — otherwise reject rather than silently empty.
    if (query.channelId) await this.acl.requireMember(query.channelId, actor);

    const author = aliasedTable(users, 'chat_search_author');
    const before = query.cursor ? decodeCursor(query.cursor) : null;
    const tsQuery = sql`websearch_to_tsquery('russian', ${query.q})`;

    const rows = await this.db
      .select({
        messageId: chatMessages.id,
        channelId: chatMessages.channelId,
        channelKind: chatChannels.kind,
        channelName: chatChannels.name,
        authorName: author.shortName,
        bodyText: chatMessages.bodyText,
        createdAt: chatMessages.createdAt,
      })
      .from(chatMessages)
      .innerJoin(
        chatMembers,
        and(eq(chatMembers.channelId, chatMessages.channelId), eq(chatMembers.userId, actor.id)),
      )
      .innerJoin(
        chatChannels,
        and(eq(chatChannels.id, chatMessages.channelId), isNull(chatChannels.deletedAt)),
      )
      .leftJoin(author, eq(author.id, chatMessages.authorId))
      .where(
        and(
          isNull(chatMessages.deletedAt),
          sql`search_tsv @@ ${tsQuery}`,
          query.channelId ? eq(chatMessages.channelId, query.channelId) : undefined,
          query.fromUserId ? eq(chatMessages.authorId, query.fromUserId) : undefined,
          query.period !== 'all'
            ? sql`${chatMessages.createdAt} >= now() - ${`${PERIOD_DAYS[query.period]} days`}::interval`
            : undefined,
          before
            ? sql`(${chatMessages.createdAt}, ${chatMessages.id}) < (${before.createdAt}, ${before.id})`
            : undefined,
        ),
      )
      .orderBy(desc(chatMessages.createdAt), desc(chatMessages.id))
      .limit(query.limit + 1);

    const hasMore = rows.length > query.limit;
    const pageRows = hasMore ? rows.slice(0, query.limit) : rows;

    // Resolve display names for DM/group hits so the client can label the conversation.
    const dmChannelIds = [
      ...new Set(
        pageRows
          .filter((r) => r.channelKind === 'dm' || r.channelKind === 'group')
          .map((r) => r.channelId),
      ),
    ];
    const others = await this.otherMembers(actor.id, dmChannelIds);

    const items: ChatSearchResultDto[] = pageRows.map((r) => ({
      messageId: r.messageId,
      channelId: r.channelId,
      channelKind: r.channelKind,
      channelName: r.channelName,
      otherMembers: others.get(r.channelId) ?? [],
      authorName: r.authorName ?? null,
      bodyText: r.bodyText,
      createdAt: r.createdAt.toISOString(),
    }));
    const last = pageRows[pageRows.length - 1];
    return {
      items,
      nextCursor:
        hasMore && last ? encodeCursor(last.createdAt.toISOString(), last.messageId) : null,
    };
  }

  private async otherMembers(
    userId: string,
    channelIds: string[],
  ): Promise<Map<string, { userId: string; name: string | null }[]>> {
    if (channelIds.length === 0) return new Map();
    const member = aliasedTable(users, 'chat_search_other');
    const rows = await this.db
      .select({
        channelId: chatMembers.channelId,
        userId: chatMembers.userId,
        name: member.shortName,
      })
      .from(chatMembers)
      .leftJoin(member, eq(member.id, chatMembers.userId))
      .where(
        and(inArray(chatMembers.channelId, channelIds), sql`${chatMembers.userId} <> ${userId}`),
      );
    const map = new Map<string, { userId: string; name: string | null }[]>();
    for (const r of rows) {
      const list = map.get(r.channelId) ?? [];
      list.push({ userId: r.userId, name: r.name ?? null });
      map.set(r.channelId, list);
    }
    return map;
  }
}
