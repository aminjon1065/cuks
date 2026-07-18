import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { meetRooms, meetings, recordings, type Database } from '@cuks/db';
import { wsRooms } from '@cuks/shared';
import { EgressStatus } from 'livekit-server-sdk';
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
      case 'egress_ended':
        try {
          await this.onEgressEnded(event);
        } catch (err) {
          this.logger.error({ err }, 'egress_ended handling failed');
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
    if (room) {
      // Meeting lifecycle (docs/modules/14 §5): nothing else ever advances a
      // scheduled meeting, so without this a meeting that finished TODAY never
      // reaches the «Прошедшие» tab until the Dushanbe midnight boundary.
      await this.db
        .update(meetings)
        .set({ status: 'done', updatedAt: new Date() })
        .where(and(eq(meetings.roomId, room.id), inArray(meetings.status, ['scheduled', 'live'])));
      // Recording rows stuck in `processing` with NO egress id are start-crash
      // orphans (the start RPC died between the insert and the id update); once
      // the room is finished no webhook will ever complete them — they would
      // hold a global recording slot and 409-block this room forever.
      await this.db
        .update(recordings)
        .set({ status: 'failed', updatedAt: new Date() })
        .where(
          and(
            eq(recordings.roomId, room.id),
            eq(recordings.status, 'processing'),
            isNull(recordings.egressId),
          ),
        );
    }
  }

  /** Egress finished — complete the recording row and tell participants (docs/modules/14 §4/§6). */
  private async onEgressEnded(event: WebhookEvent): Promise<void> {
    const info = event.egressInfo;
    if (!info) return;
    const file = info.fileResults[0];
    const ok = info.status === EgressStatus.EGRESS_COMPLETE && !!file;
    const patch = ok
      ? {
          status: 'ready' as const,
          fileKey: file.filename,
          size: Number(file.size),
          // FileInfo.duration is int64 NANOSECONDS.
          duration: Math.round(Number(file.duration) / 1e9),
          updatedAt: new Date(),
        }
      : { status: 'failed' as const, updatedAt: new Date() };
    let [row] = await this.db
      .update(recordings)
      .set(patch)
      .where(eq(recordings.egressId, info.egressId))
      .returning({
        id: recordings.id,
        roomId: recordings.roomId,
        startedBy: recordings.startedBy,
        participants: recordings.participants,
      });
    if (!row && file) {
      // Race window: an egress that dies instantly can deliver egress_ended
      // BEFORE the start path stored its egressId. The object key is derived
      // from the recording id at start, so match the still-`processing` row by
      // file key instead of silently dropping the webhook (which left the row
      // `processing` forever, occupying a global slot and 409-blocking the room).
      [row] = await this.db
        .update(recordings)
        .set(patch)
        .where(and(eq(recordings.fileKey, file.filename), eq(recordings.status, 'processing')))
        .returning({
          id: recordings.id,
          roomId: recordings.roomId,
          startedBy: recordings.startedBy,
          participants: recordings.participants,
        });
    }
    if (!row) return;
    for (const userId of new Set([...(row.participants ?? []), row.startedBy].filter(Boolean))) {
      this.realtime.emitToUser(userId as string, 'meet.recording.state', {
        recordingId: row.id,
        roomId: row.roomId,
        status: ok ? 'ready' : 'failed',
      });
    }
  }
}
