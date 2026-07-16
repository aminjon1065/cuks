import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { meetRooms, type Database } from '@cuks/db';
import { wsRooms } from '@cuks/shared';
import type { WebhookEvent } from 'livekit-server-sdk';
import { DB } from '../../common/db/db.module';
import { RealtimeService } from '../events/realtime.service';

export interface WebhookHandlingResult {
  event: string;
  handled: boolean;
}

/**
 * Dispatches verified LiveKit webhook events (docs/modules/14 §6). `room_finished` (the SFU room
 * emptied — last participant left) retires the meet_room and drops its «Идёт звонок» banner, so a call
 * that ends by everyone leaving (not only by the host's «end for all») clears the banner. The
 * remaining lifecycle hooks (meet_calls history, recordings) land with their tables in later tasks;
 * unknown/new events are acknowledged rather than throwing, so the webhook never 500s (which would
 * make LiveKit retry indefinitely).
 */
@Injectable()
export class MeetWebhookService {
  private readonly logger = new Logger(MeetWebhookService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly realtime: RealtimeService,
  ) {}

  async handle(event: WebhookEvent): Promise<WebhookHandlingResult> {
    const name = event.event;
    switch (name) {
      case 'room_finished':
        try {
          await this.onRoomFinished(event);
        } catch (err) {
          this.logger.error({ err }, 'room_finished handling failed');
        }
        return { event: name, handled: true };
      case 'room_started':
      case 'participant_joined':
      case 'participant_left':
      case 'participant_connection_aborted':
      case 'track_published':
      case 'track_unpublished':
      case 'egress_started':
      case 'egress_updated':
      case 'egress_ended':
        this.logger.debug(`livekit webhook: ${name} (id=${event.id})`);
        return { event: name, handled: true };
      default:
        this.logger.debug(`livekit webhook: unhandled event "${name}"`);
        return { event: name, handled: false };
    }
  }

  /** The SFU room emptied — mark the room inactive and drop the channel call banner (docs/modules/14 §2). */
  private async onRoomFinished(event: WebhookEvent): Promise<void> {
    const roomName = event.room?.name;
    if (!roomName) return;
    const [room] = await this.db
      .update(meetRooms)
      .set({ isActive: false })
      .where(and(eq(meetRooms.livekitRoom, roomName), eq(meetRooms.isActive, true)))
      .returning({ id: meetRooms.id, channelId: meetRooms.channelId });
    if (room?.channelId) {
      this.realtime.emitToRoom(wsRooms.channel(room.channelId), 'meet.room.updated', {
        channelId: room.channelId,
        roomId: room.id,
        active: false,
      });
    }
  }
}
