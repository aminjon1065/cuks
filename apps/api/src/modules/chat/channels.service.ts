import { Inject, Injectable } from '@nestjs/common';
import { aliasedTable, and, count, desc, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm';
import { chatChannels, chatMembers, chatMessages, users, type Database } from '@cuks/db';
import {
  wsRooms,
  type AddChannelMemberInput,
  type ChannelDto,
  type ChannelListItemDto,
  type ChatMemberDto,
  type CreateChannelInput,
  type CreateDmInput,
  type MarkReadInput,
  type UpdateChannelInput,
  type UpdateMembershipInput,
} from '@cuks/shared';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthUser } from '../../common/auth/auth-user';
import { AppException } from '../../common/exceptions/app.exception';
import { DB } from '../../common/db/db.module';
import { RealtimeService } from '../events/realtime.service';
import { ChatAclService } from './chat-acl.service';

type ChannelRow = typeof chatChannels.$inferSelect;

/** Channels, DMs and membership (docs/modules/13 §2/§8, task 5.2). */
@Injectable()
export class ChannelsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly acl: ChatAclService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
  ) {}

  /** The caller's conversations — pinned first, then most-recent — with unread counts. */
  async myChannels(actor: AuthUser): Promise<ChannelListItemDto[]> {
    const rows = await this.db
      .select({
        channel: chatChannels,
        role: chatMembers.memberRole,
        lastRead: chatMembers.lastReadMessageId,
        isPinned: chatMembers.isPinned,
      })
      .from(chatMembers)
      .innerJoin(
        chatChannels,
        and(eq(chatChannels.id, chatMembers.channelId), isNull(chatChannels.deletedAt)),
      )
      .where(eq(chatMembers.userId, actor.id))
      .orderBy(desc(chatMembers.isPinned), sql`${chatChannels.lastMessageAt} desc nulls last`);

    const ids = rows.map((r) => r.channel.id);
    const [memberCounts, unread, others] = await Promise.all([
      this.memberCounts(ids),
      this.unreadCounts(actor.id, ids),
      this.otherMembers(
        actor.id,
        rows
          .filter((r) => r.channel.kind === 'dm' || r.channel.kind === 'group')
          .map((r) => r.channel.id),
      ),
    ]);
    return rows.map((r) =>
      this.toListItem(
        r.channel,
        r.role,
        memberCounts.get(r.channel.id) ?? 0,
        unread.get(r.channel.id) ?? 0,
        others.get(r.channel.id) ?? [],
      ),
    );
  }

  /** Public channels the caller is not yet in (docs/modules/13 §2). */
  async catalog(actor: AuthUser): Promise<ChannelListItemDto[]> {
    const mine = this.db
      .select({ id: chatMembers.channelId })
      .from(chatMembers)
      .where(eq(chatMembers.userId, actor.id));
    const rows = await this.db
      .select()
      .from(chatChannels)
      .where(
        and(
          eq(chatChannels.kind, 'public'),
          eq(chatChannels.isArchived, false),
          isNull(chatChannels.deletedAt),
          sql`${chatChannels.id} not in ${mine}`,
        ),
      )
      .orderBy(desc(chatChannels.lastMessageAt));
    const counts = await this.memberCounts(rows.map((r) => r.id));
    return rows.map((r) => this.toListItem(r, null, counts.get(r.id) ?? 0, 0, []));
  }

  async get(channelId: string, actor: AuthUser): Promise<ChannelDto> {
    const channel = await this.acl.requireMember(channelId, actor);
    const [members, memberCounts, unread, others] = await Promise.all([
      this.channelMembers(channelId),
      this.memberCounts([channelId]),
      this.unreadCounts(actor.id, [channelId]),
      this.otherMembers(actor.id, [channelId]),
    ]);
    const role = members.find((m) => m.userId === actor.id)?.role ?? null;
    const base = this.toListItem(
      channel,
      role,
      memberCounts.get(channelId) ?? members.length,
      unread.get(channelId) ?? 0,
      others.get(channelId) ?? [],
    );
    return { ...base, members };
  }

  async createChannel(input: CreateChannelInput, actor: AuthUser): Promise<ChannelDto> {
    const channelId = await this.db.transaction(async (tx) => {
      const [ch] = await tx
        .insert(chatChannels)
        .values({
          kind: input.kind,
          name: input.name,
          topic: input.topic ?? null,
          createdBy: actor.id,
        })
        .returning({ id: chatChannels.id });
      await tx
        .insert(chatMembers)
        .values({ channelId: ch!.id, userId: actor.id, memberRole: 'owner' });
      return ch!.id;
    });
    this.audit.log({
      action: 'chat.channel.created',
      actorId: actor.id,
      entityType: 'chat_channel',
      entityId: channelId,
      meta: { kind: input.kind },
    });
    return this.get(channelId, actor);
  }

  async updateChannel(
    channelId: string,
    input: UpdateChannelInput,
    actor: AuthUser,
  ): Promise<ChannelDto> {
    await this.acl.requireMember(channelId, actor, 'admin');
    await this.db
      .update(chatChannels)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.topic !== undefined ? { topic: input.topic ?? null } : {}),
        updatedAt: new Date(),
      })
      .where(eq(chatChannels.id, channelId));
    this.emitChannelUpdated(channelId, actor.id);
    return this.get(channelId, actor);
  }

  /** Join a public channel (self) or add another user (admin+ of a private channel). */
  async addMember(
    channelId: string,
    input: AddChannelMemberInput,
    actor: AuthUser,
  ): Promise<ChannelDto> {
    const channel = await this.acl.loadChannel(channelId);
    const selfJoin = input.userId === actor.id;
    if (selfJoin) {
      // Only public channels are freely joinable.
      if (channel.kind !== 'public') {
        throw AppException.forbidden('chat.channel.not_joinable', 'Channel is invite-only');
      }
    } else {
      await this.acl.requireMember(channelId, actor, 'admin');
      await this.requireUser(input.userId);
    }
    await this.db
      .insert(chatMembers)
      .values({ channelId, userId: input.userId, memberRole: selfJoin ? 'member' : input.role })
      .onConflictDoNothing({ target: [chatMembers.channelId, chatMembers.userId] });
    this.emitChannelUpdated(channelId, actor.id);
    return this.get(channelId, actor.id === input.userId ? actor : actor);
  }

  async removeMember(channelId: string, userId: string, actor: AuthUser): Promise<void> {
    const selfLeave = userId === actor.id;
    if (!selfLeave) await this.acl.requireMember(channelId, actor, 'admin');
    else await this.acl.requireMember(channelId, actor);
    await this.db
      .delete(chatMembers)
      .where(and(eq(chatMembers.channelId, channelId), eq(chatMembers.userId, userId)));
    this.emitChannelUpdated(channelId, actor.id);
  }

  /** Open (or reuse) a direct / group conversation (docs/modules/13 §2). */
  async createDm(input: CreateDmInput, actor: AuthUser): Promise<ChannelDto> {
    const others = [...new Set(input.userIds)].filter((id) => id !== actor.id);
    if (others.length === 0) {
      throw AppException.badRequest('chat.dm.no_recipients', 'Pick at least one other user');
    }
    await Promise.all(others.map((id) => this.requireUser(id)));
    const all = [actor.id, ...others];
    const kind = all.length === 2 ? 'dm' : 'group';

    if (kind === 'dm') {
      const existing = await this.findDm(actor.id, others[0]!);
      if (existing) return this.get(existing, actor);
    }
    const channelId = await this.db.transaction(async (tx) => {
      const [ch] = await tx
        .insert(chatChannels)
        .values({ kind, name: null, createdBy: actor.id })
        .returning({ id: chatChannels.id });
      await tx.insert(chatMembers).values(
        all.map((userId) => ({
          channelId: ch!.id,
          userId,
          memberRole: (userId === actor.id ? 'owner' : 'member') as 'owner' | 'member',
        })),
      );
      return ch!.id;
    });
    return this.get(channelId, actor);
  }

  async markRead(channelId: string, input: MarkReadInput, actor: AuthUser): Promise<void> {
    await this.acl.requireMember(channelId, actor);
    await this.db
      .update(chatMembers)
      .set({ lastReadMessageId: input.messageId })
      .where(and(eq(chatMembers.channelId, channelId), eq(chatMembers.userId, actor.id)));
  }

  async updateMembership(
    channelId: string,
    input: UpdateMembershipInput,
    actor: AuthUser,
  ): Promise<void> {
    await this.acl.requireMember(channelId, actor);
    await this.db
      .update(chatMembers)
      .set({
        ...(input.notifyLevel !== undefined ? { notifyLevel: input.notifyLevel } : {}),
        ...(input.isPinned !== undefined ? { isPinned: input.isPinned } : {}),
      })
      .where(and(eq(chatMembers.channelId, channelId), eq(chatMembers.userId, actor.id)));
  }

  // --- Helpers ---

  private toListItem(
    channel: ChannelRow,
    role: ChatMemberDto['role'] | null,
    memberCount: number,
    unreadCount: number,
    otherMembers: { userId: string; name: string | null }[],
  ): ChannelListItemDto {
    return {
      id: channel.id,
      kind: channel.kind,
      name: channel.name,
      topic: channel.topic,
      orgUnitId: channel.orgUnitId,
      isArchived: channel.isArchived,
      lastMessageAt: channel.lastMessageAt?.toISOString() ?? null,
      myRole: role,
      memberCount,
      unreadCount,
      otherMembers,
    };
  }

  private async channelMembers(channelId: string): Promise<ChatMemberDto[]> {
    const member = aliasedTable(users, 'chat_member_user');
    const rows = await this.db
      .select({
        userId: chatMembers.userId,
        name: member.shortName,
        role: chatMembers.memberRole,
        notifyLevel: chatMembers.notifyLevel,
      })
      .from(chatMembers)
      .leftJoin(member, eq(member.id, chatMembers.userId))
      .where(eq(chatMembers.channelId, channelId));
    return rows.map((r) => ({
      userId: r.userId,
      name: r.name ?? null,
      role: r.role,
      notifyLevel: r.notifyLevel,
    }));
  }

  private async memberCounts(channelIds: string[]): Promise<Map<string, number>> {
    if (!channelIds.length) return new Map();
    const rows = await this.db
      .select({ channelId: chatMembers.channelId, n: count() })
      .from(chatMembers)
      .where(inArray(chatMembers.channelId, channelIds))
      .groupBy(chatMembers.channelId);
    return new Map(rows.map((r) => [r.channelId, Number(r.n)]));
  }

  /** Unread = messages after the member's last_read (or all, if never read), not deleted. */
  private async unreadCounts(userId: string, channelIds: string[]): Promise<Map<string, number>> {
    if (!channelIds.length) return new Map();
    const rows = await this.db
      .select({ channelId: chatMembers.channelId, n: count(chatMessages.id) })
      .from(chatMembers)
      .leftJoin(
        chatMessages,
        and(
          eq(chatMessages.channelId, chatMembers.channelId),
          isNull(chatMessages.deletedAt),
          or(
            isNull(chatMembers.lastReadMessageId),
            gt(chatMessages.id, chatMembers.lastReadMessageId),
          ),
        ),
      )
      .where(and(eq(chatMembers.userId, userId), inArray(chatMembers.channelId, channelIds)))
      .groupBy(chatMembers.channelId);
    return new Map(rows.map((r) => [r.channelId, Number(r.n)]));
  }

  private async otherMembers(
    userId: string,
    channelIds: string[],
  ): Promise<Map<string, { userId: string; name: string | null }[]>> {
    if (!channelIds.length) return new Map();
    const member = aliasedTable(users, 'chat_other_user');
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

  private async findDm(a: string, b: string): Promise<string | null> {
    const [row] = await this.db
      .select({ id: chatChannels.id })
      .from(chatChannels)
      .where(
        and(
          eq(chatChannels.kind, 'dm'),
          isNull(chatChannels.deletedAt),
          sql`exists (select 1 from ${chatMembers} m where m.channel_id = ${chatChannels.id} and m.user_id = ${a})`,
          sql`exists (select 1 from ${chatMembers} m where m.channel_id = ${chatChannels.id} and m.user_id = ${b})`,
          sql`(select count(*) from ${chatMembers} m where m.channel_id = ${chatChannels.id}) = 2`,
        ),
      )
      .limit(1);
    return row?.id ?? null;
  }

  private async requireUser(userId: string): Promise<void> {
    const [u] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, userId), isNull(users.deletedAt)))
      .limit(1);
    if (!u) throw AppException.notFound('chat.user.not_found', 'User not found');
  }

  private emitChannelUpdated(channelId: string, actorId: string): void {
    this.realtime.emitToRoom(wsRooms.channel(channelId), 'chat.channel.updated', {
      channelId,
      actorId,
    });
  }
}
