import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { chatChannels, chatMembers, type Database } from '@cuks/db';
import type { ChannelMemberRole } from '@cuks/shared';
import type { AuthUser } from '../../common/auth/auth-user';
import { AppException } from '../../common/exceptions/app.exception';
import { DB } from '../../common/db/db.module';

type ChannelRow = typeof chatChannels.$inferSelect;

/** owner > admin > member — a higher rank includes the lower ones' abilities. */
const RANK: Record<ChannelMemberRole, number> = { member: 1, admin: 2, owner: 3 };

/**
 * Channel access control (docs/modules/13 §1, task 5.2). Reading and posting require an explicit
 * membership row; managing the channel needs `admin`+. A public channel is visible in the catalog and
 * joinable, but its messages are only readable once joined.
 */
@Injectable()
export class ChatAclService {
  constructor(@Inject(DB) private readonly db: Database) {}

  /** The caller's role in the channel, or null. */
  async roleFor(channelId: string, userId: string): Promise<ChannelMemberRole | null> {
    const [m] = await this.db
      .select({ role: chatMembers.memberRole })
      .from(chatMembers)
      .where(and(eq(chatMembers.channelId, channelId), eq(chatMembers.userId, userId)))
      .limit(1);
    return m?.role ?? null;
  }

  async loadChannel(channelId: string): Promise<ChannelRow> {
    const [row] = await this.db
      .select()
      .from(chatChannels)
      .where(and(eq(chatChannels.id, channelId), isNull(chatChannels.deletedAt)))
      .limit(1);
    if (!row) throw AppException.notFound('chat.channel.not_found', 'Channel not found');
    return row;
  }

  /** Load a channel the caller belongs to with at least `min` role, or 404/403. */
  async requireMember(
    channelId: string,
    actor: AuthUser,
    min: ChannelMemberRole = 'member',
  ): Promise<ChannelRow> {
    const channel = await this.loadChannel(channelId);
    const role = await this.roleFor(channelId, actor.id);
    if (!role || RANK[role] < RANK[min]) {
      throw AppException.forbidden('chat.channel.forbidden', 'Not a channel member');
    }
    return channel;
  }
}
