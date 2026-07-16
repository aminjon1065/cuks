import { Inject, Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { and, eq, isNull } from 'drizzle-orm';
import { chatChannels, chatMembers, meetRooms, type Database } from '@cuks/db';
import { QUEUE, type MeetRingJobData, type StartRingInput } from '@cuks/shared';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthUser } from '../../common/auth/auth-user';
import { DB } from '../../common/db/db.module';
import { AppException } from '../../common/exceptions/app.exception';
import { REDIS } from '../../common/redis/redis.module';
import { NotificationsService } from '../notifications/notifications.service';
import { RealtimeService } from '../events/realtime.service';
import { MeetSystemMessagesService } from './meet-system-messages.service';

/** A ring outlives the 30 s timeout job a little, so a late accept still finds it. */
const RING_TTL_SECONDS = 40;
const RING_TIMEOUT_MS = 30_000;
const ringKey = (roomId: string): string => `meet:ring:${roomId}`;
// A BullMQ custom job id may not contain ':' — use a dash-joined id.
const jobId = (roomId: string): string => `meet-ring-${roomId}`;

interface RingState {
  callerId: string;
  callerName: string;
  recipientId: string;
  channelId: string;
  media: 'audio' | 'video';
  slug: string;
}

/**
 * 1:1 call ring-flow (docs/modules/14 §2). The caller (already in the DM's room) rings the other DM
 * member: a `meet.ring` realtime event + an in-app notification, plus a delayed «no answer» job. The
 * ring lives in Redis; accept/decline/cancel and the timeout each consume it exactly once.
 */
@Injectable()
export class RingService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(REDIS) private readonly redis: Redis,
    @InjectQueue(QUEUE.meetRing) private readonly queue: Queue<MeetRingJobData>,
    private readonly realtime: RealtimeService,
    private readonly notifications: NotificationsService,
    private readonly system: MeetSystemMessagesService,
    private readonly audit: AuditService,
  ) {}

  /** Ring the recipient for the caller's DM room. Caller must own the room; recipient must be the
   *  other member of its DM channel. */
  async start(caller: AuthUser, input: StartRingInput): Promise<void> {
    const [room] = await this.db
      .select({
        id: meetRooms.id,
        slug: meetRooms.slug,
        channelId: meetRooms.channelId,
        createdBy: meetRooms.createdBy,
      })
      .from(meetRooms)
      .where(eq(meetRooms.id, input.roomId))
      .limit(1);
    if (!room) throw AppException.notFound('meet.room.not_found', 'Room not found');
    if (room.createdBy !== caller.id) {
      throw AppException.forbidden('meet.ring.not_caller', 'Only the room owner can ring');
    }
    if (!room.channelId) {
      throw AppException.badRequest('meet.ring.not_dm', 'This room is not a direct message');
    }
    await this.assertDmPair(room.channelId, caller.id, input.userId);

    const state: RingState = {
      callerId: caller.id,
      callerName: caller.shortName,
      recipientId: input.userId,
      channelId: room.channelId,
      media: input.media,
      slug: room.slug,
    };
    await this.redis.set(ringKey(room.id), JSON.stringify(state), 'EX', RING_TTL_SECONDS);
    this.realtime.emitToUser(input.userId, 'meet.ring', {
      roomId: room.id,
      slug: room.slug,
      channelId: room.channelId,
      fromUserId: caller.id,
      fromName: caller.shortName,
      media: input.media,
    });
    // In-app ring notification (no email — a call is only answerable live).
    void this.notifications.notifyMany({
      userIds: [input.userId],
      type: 'meet.ring',
      title: 'Входящий звонок',
      body: `${caller.shortName} звонит вам`,
      entityType: 'meet_room',
      entityId: room.id,
      priority: 'normal',
      emailMode: 'never',
      dedupeKey: `meet:ring:${room.id}`,
    });
    await this.queue.add(
      'timeout',
      {
        roomId: room.id,
        recipientId: input.userId,
        channelId: room.channelId,
        callerId: caller.id,
        media: input.media,
      },
      { delay: RING_TIMEOUT_MS, jobId: jobId(room.id) },
    );
  }

  /** The recipient accepts — the ring stops; they then join the room via the token endpoint. */
  async accept(user: AuthUser, roomId: string): Promise<void> {
    const state = await this.take(roomId, user.id, 'recipient');
    this.realtime.emitToUser(state.callerId, 'meet.ring.cancelled', { roomId, reason: 'accepted' });
    this.realtime.emitToUser(state.recipientId, 'meet.ring.cancelled', {
      roomId,
      reason: 'accepted',
    });
  }

  /** The recipient declines — the caller is told and a «declined» card is posted to the DM. */
  async decline(user: AuthUser, roomId: string): Promise<void> {
    const state = await this.take(roomId, user.id, 'recipient');
    this.realtime.emitToUser(state.callerId, 'meet.ring.cancelled', { roomId, reason: 'declined' });
    await this.system.postCallMessage(
      state.channelId,
      { call: 'declined', media: state.media, roomId, slug: state.slug },
      state.callerId,
    );
  }

  /** The caller cancels before an answer — the recipient's prompt is dismissed. */
  async cancel(user: AuthUser, roomId: string): Promise<void> {
    const state = await this.take(roomId, user.id, 'caller');
    this.realtime.emitToUser(state.recipientId, 'meet.ring.cancelled', {
      roomId,
      reason: 'cancelled',
    });
  }

  /** Delayed «no answer» handler (run in-process by MeetRingProcessor). No-op if already resolved. */
  async handleTimeout(job: MeetRingJobData): Promise<void> {
    const raw = await this.redis.getdel(ringKey(job.roomId));
    if (!raw) return; // answered / declined / cancelled first
    const state = JSON.parse(raw) as RingState;
    this.realtime.emitToUser(state.recipientId, 'meet.ring.cancelled', {
      roomId: job.roomId,
      reason: 'missed',
    });
    this.realtime.emitToUser(state.callerId, 'meet.ring.cancelled', {
      roomId: job.roomId,
      reason: 'missed',
    });
    await this.system.postCallMessage(
      state.channelId,
      { call: 'missed', media: state.media, roomId: job.roomId, slug: state.slug },
      state.callerId,
    );
    this.audit.log({
      action: 'meet.ring.missed',
      actorId: state.callerId,
      entityType: 'meet_room',
      entityId: job.roomId,
      meta: { recipientId: state.recipientId },
    });
  }

  /** Read + delete the ring, asserting the actor is the expected party. */
  private async take(
    roomId: string,
    userId: string,
    who: 'caller' | 'recipient',
  ): Promise<RingState> {
    const raw = await this.redis.get(ringKey(roomId));
    if (!raw) throw AppException.notFound('meet.ring.not_found', 'No active ring for this room');
    const state = JSON.parse(raw) as RingState;
    const owner = who === 'caller' ? state.callerId : state.recipientId;
    if (owner !== userId) {
      throw AppException.forbidden('meet.ring.forbidden', 'Not a party to this ring');
    }
    await this.redis.del(ringKey(roomId));
    // Cancel the pending timeout (best-effort — the timeout also checks the key is gone).
    await this.queue.remove(jobId(roomId)).catch(() => undefined);
    return state;
  }

  private async assertDmPair(
    channelId: string,
    callerId: string,
    recipientId: string,
  ): Promise<void> {
    if (callerId === recipientId) {
      throw AppException.badRequest('meet.ring.self', 'Cannot ring yourself');
    }
    const [channel] = await this.db
      .select({ kind: chatChannels.kind })
      .from(chatChannels)
      .where(and(eq(chatChannels.id, channelId), isNull(chatChannels.deletedAt)))
      .limit(1);
    if (!channel) throw AppException.notFound('meet.channel.not_found', 'Channel not found');
    if (channel.kind !== 'dm') {
      throw AppException.badRequest('meet.ring.not_dm', 'Ringing is only for 1:1 direct messages');
    }
    const members = await this.db
      .select({ userId: chatMembers.userId })
      .from(chatMembers)
      .where(eq(chatMembers.channelId, channelId));
    const ids = new Set(members.map((m) => m.userId));
    if (!ids.has(callerId) || !ids.has(recipientId)) {
      throw AppException.forbidden(
        'meet.ring.not_member',
        'Both parties must be in the conversation',
      );
    }
  }
}
