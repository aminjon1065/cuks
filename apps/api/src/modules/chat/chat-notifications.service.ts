import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { chatMembers, type Database } from '@cuks/db';
import {
  extractMentionIds,
  truncateSafe,
  wsRooms,
  type ChannelKind,
  type ChatNotifyLevel,
} from '@cuks/shared';
import { DB } from '../../common/db/db.module';
import { NotificationsService } from '../notifications/notifications.service';
import { RealtimeService } from '../events/realtime.service';

export interface MemberNotify {
  userId: string;
  notifyLevel: ChatNotifyLevel;
}

/**
 * Who a chat message notifies (docs/modules/13 §6). A member is notified when they are NOT the author,
 * have not muted the channel, are not currently viewing it, and either: it is a DM/group (a direct
 * message), their level is `all`, or their level is `mentions` and they were personally mentioned.
 * Pure — unit-tested.
 */
export function chatMessageRecipients(input: {
  channelKind: ChannelKind;
  authorId: string | null;
  members: MemberNotify[];
  mentionedIds: ReadonlySet<string>;
  viewingIds: ReadonlySet<string>;
}): string[] {
  const isDm = input.channelKind === 'dm' || input.channelKind === 'group';
  return input.members
    .filter(
      (m) =>
        m.userId !== input.authorId &&
        m.notifyLevel !== 'mute' &&
        !input.viewingIds.has(m.userId) &&
        (isDm ||
          m.notifyLevel === 'all' ||
          (m.notifyLevel === 'mentions' && input.mentionedIds.has(m.userId))),
    )
    .map((m) => m.userId);
}

/**
 * Fans a posted message out to in-app + (offline) email notifications (docs/modules/13 §6). Respects
 * the per-channel notify level and skips anyone actively watching the channel; email only fires when
 * the recipient has been offline past the threshold (NotificationsService, emailMode 'offline').
 */
@Injectable()
export class ChatNotificationsService {
  private readonly logger = new Logger(ChatNotificationsService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeService,
  ) {}

  /** Best-effort — a notification failure must never fail the send. */
  async notifyForMessage(input: {
    channelId: string;
    channelKind: ChannelKind;
    channelName: string | null;
    messageId: string;
    authorId: string;
    authorName: string;
    body: unknown;
    bodyText: string | null;
  }): Promise<void> {
    try {
      const members = await this.db
        .select({ userId: chatMembers.userId, notifyLevel: chatMembers.notifyLevel })
        .from(chatMembers)
        .where(eq(chatMembers.channelId, input.channelId));
      const memberIds = new Set(members.map((m) => m.userId));
      const mentionedIds = new Set(extractMentionIds(input.body).filter((id) => memberIds.has(id)));
      const viewingIds = await this.realtime.userIdsInRoom(wsRooms.channel(input.channelId));

      const recipients = chatMessageRecipients({
        channelKind: input.channelKind,
        authorId: input.authorId,
        members,
        mentionedIds,
        viewingIds,
      });
      if (recipients.length === 0) return;

      const snippet = input.bodyText ? truncateSafe(input.bodyText, 140) : '📎';
      const isDm = input.channelKind === 'dm' || input.channelKind === 'group';
      const base = {
        body: snippet,
        entityType: 'chat_channel',
        entityId: input.channelId,
        payload: { messageId: input.messageId, channelId: input.channelId },
        priority: 'normal' as const,
        emailMode: 'offline' as const,
        dedupeKey: `chat:msg:${input.messageId}`,
      };

      const mentioned = recipients.filter((id) => mentionedIds.has(id));
      const rest = recipients.filter((id) => !mentionedIds.has(id));

      if (mentioned.length > 0) {
        await this.notifications.notifyMany({
          ...base,
          userIds: mentioned,
          type: 'chat.message.mention',
          title: `${input.authorName} упомянул вас`,
        });
      }
      if (rest.length > 0) {
        await this.notifications.notifyMany({
          ...base,
          userIds: rest,
          type: isDm ? 'chat.dm.message' : 'chat.message.new',
          title: isDm
            ? `Личное сообщение от ${input.authorName}`
            : `Новое сообщение в «${input.channelName ?? ''}»`,
        });
      }
    } catch (err) {
      this.logger.error(
        { err, channelId: input.channelId },
        'failed to fan out chat notifications',
      );
    }
  }
}
