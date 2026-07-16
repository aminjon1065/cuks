import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { chatChannels, chatMessages, type Database } from '@cuks/db';
import { wsRooms, type MeetCallMessageBody } from '@cuks/shared';
import { DB } from '../../common/db/db.module';
import { RealtimeService } from '../events/realtime.service';

/**
 * Call system messages (docs/modules/14 §2): a `kind: 'call'` card posted into the conversation for
 * missed / declined / started / ended events. Inserted directly (not through the chat send path) and
 * broadcast to the channel like any message, so open feeds show it live.
 */
@Injectable()
export class MeetSystemMessagesService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly realtime: RealtimeService,
  ) {}

  async postCallMessage(
    channelId: string,
    body: MeetCallMessageBody,
    authorId: string | null,
  ): Promise<void> {
    const now = new Date();
    const [row] = await this.db
      .insert(chatMessages)
      .values({
        channelId,
        authorId,
        kind: 'call',
        body,
        bodyText: callText(body.call),
        fileIds: [],
        createdAt: now,
      })
      .returning({ id: chatMessages.id });
    await this.db
      .update(chatChannels)
      .set({ lastMessageAt: now, updatedAt: now })
      .where(eq(chatChannels.id, channelId));
    this.realtime.emitToRoom(wsRooms.channel(channelId), 'chat.message.created', {
      channelId,
      messageId: row!.id,
      actorId: authorId ?? '',
    });
  }
}

/** Plain-text preview stored on the message (conversation list + search); the UI renders the card. */
function callText(event: MeetCallMessageBody['call']): string {
  switch (event) {
    case 'missed':
      return 'Пропущенный звонок';
    case 'declined':
      return 'Звонок отклонён';
    case 'started':
      return 'Звонок начался';
    case 'ended':
      return 'Звонок завершён';
  }
}
