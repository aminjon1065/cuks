import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { chatChannels, chatMessages, type Database } from '@cuks/db';
import { wsRooms } from '@cuks/shared';
import { DB } from '../../common/db/db.module';
import { ConfigService } from '../../config/config.service';
import { RealtimeService } from '../events/realtime.service';

/**
 * Turns an inbound monitoring alert (Uptime Kuma) into a system message in the configured chat channel
 * (docs/modules/16 §7). Inserted directly as a `kind: 'system'` message (no author, no ACL/send path) and
 * broadcast to the channel like meet-system-messages, so an open feed shows it live.
 */
@Injectable()
export class MonitoringAlertService {
  private readonly logger = new Logger(MonitoringAlertService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly config: ConfigService,
    private readonly realtime: RealtimeService,
  ) {}

  /** Whether the alert webhook is enabled (secret + target channel both set). */
  get enabled(): boolean {
    return Boolean(this.config.get('MONITORING_WEBHOOK_SECRET') && this.channelId);
  }

  get secret(): string | undefined {
    return this.config.get('MONITORING_WEBHOOK_SECRET');
  }

  private get channelId(): string | undefined {
    return this.config.get('MONITORING_ALERT_CHANNEL_ID');
  }

  async postAlert(text: string): Promise<void> {
    const channelId = this.channelId;
    if (!channelId) return;
    // Guard against an orphan message if the channel id is mistyped.
    const [channel] = await this.db
      .select({ id: chatChannels.id })
      .from(chatChannels)
      .where(eq(chatChannels.id, channelId))
      .limit(1);
    if (!channel) {
      this.logger.warn({ channelId }, 'MONITORING_ALERT_CHANNEL_ID does not exist; alert dropped');
      return;
    }

    const now = new Date();
    const [row] = await this.db
      .insert(chatMessages)
      .values({
        channelId,
        authorId: null,
        kind: 'system',
        body: null,
        bodyText: text.slice(0, 2000),
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
      actorId: '',
    });
  }
}
