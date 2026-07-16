import { randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { chatChannels, chatMembers, meetRooms, users, type Database } from '@cuks/db';
import type { CreateRoomInput, MeetRoomDto, MeetRoomRole, MeetTokenDto } from '@cuks/shared';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthUser } from '../../common/auth/auth-user';
import { DB } from '../../common/db/db.module';
import { AppException } from '../../common/exceptions/app.exception';
import { LivekitService } from './livekit.service';

/** Advisory-lock namespace — serializes concurrent «open call room» on the same channel. */
const MEET_ROOM_LOCK_NS = 4242006;

type MeetRoomRow = typeof meetRooms.$inferSelect;

/**
 * Call rooms (docs/modules/14 §5–§7, task 6.2): opening a room for a DM/channel/ad-hoc call, reading
 * it by slug, and minting a LiveKit join token. The api is the single token source; access control
 * lives here — a channel/DM call is joinable only by that conversation's members (so `meet.use` alone
 * cannot pull a token for a room whose conversation the caller isn't in), an ad-hoc `link` room by any
 * platform user with the link. Host authority is the room's creator.
 */
@Injectable()
export class MeetRoomsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly livekit: LivekitService,
    private readonly audit: AuditService,
  ) {}

  /** Open (or reuse) a call room. `dm`/`channel` rooms are one-per-conversation and membership-gated;
   *  each `adhoc` «new meeting» is a fresh link room owned by the caller. */
  async openRoom(body: CreateRoomInput, user: AuthUser): Promise<MeetRoomDto> {
    if (body.kind === 'adhoc') return this.openAdhoc(user);

    const channelId = body.channelId;
    if (!channelId) {
      throw AppException.badRequest(
        'meet.room.channel_required',
        'channelId is required for a dm/channel call',
      );
    }
    await this.assertChannelMember(channelId, user.id);

    const { id, created } = await this.db.transaction(async (tx) => {
      // Serialize concurrent openers so they converge on one live room (the partial unique index
      // on (channel_id) where is_active is the backstop).
      await tx.execute(
        sql`select pg_advisory_xact_lock(${MEET_ROOM_LOCK_NS}, hashtext(${channelId}))`,
      );
      const [existing] = await tx
        .select({ id: meetRooms.id })
        .from(meetRooms)
        .where(and(eq(meetRooms.channelId, channelId), eq(meetRooms.isActive, true)))
        .limit(1);
      if (existing) return { id: existing.id, created: false };

      const roomId = uuidv7();
      await tx.insert(meetRooms).values({
        id: roomId,
        slug: newSlug(),
        kind: body.kind,
        channelId,
        access: 'invited', // membership-gated — the channel roster is the guest list
        livekitRoom: `meet-${roomId}`,
        createdBy: user.id,
      });
      return { id: roomId, created: true };
    });

    if (created) {
      this.audit.log({
        action: 'meet.room.started',
        actorId: user.id,
        entityType: 'meet_room',
        entityId: id,
        meta: { kind: body.kind, channelId },
      });
    }
    return this.toDto(await this.requireRoomById(id), user);
  }

  /** A room by its permanent slug (`/app/meet/r/{slug}`), if the caller may access it. */
  async getBySlug(slug: string, user: AuthUser): Promise<MeetRoomDto> {
    const [room] = await this.db.select().from(meetRooms).where(eq(meetRooms.slug, slug)).limit(1);
    if (!room) throw AppException.notFound('meet.room.not_found', 'Room not found');
    await this.assertCanAccess(room, user);
    return this.toDto(room, user);
  }

  /** Mint a LiveKit join token for an active room the caller may join (docs/modules/14 §6). */
  async mintToken(roomId: string, user: AuthUser): Promise<MeetTokenDto> {
    // Authorize before the config gate so a non-member always gets 403 (not a 503 that masks it).
    const room = await this.requireRoomById(roomId);
    await this.assertCanAccess(room, user);
    if (!room.isActive) throw AppException.conflict('meet.room.ended', 'This call has ended');

    const url = this.livekit.publicUrl;
    if (!this.livekit.enabled || !url) {
      throw AppException.serviceUnavailable('meet.unavailable', 'Calls are not configured');
    }
    const token = await this.livekit.createJoinToken({
      room: room.livekitRoom,
      identity: user.id,
      name: user.shortName || user.fullName,
      avatar: await this.avatarOf(user.id),
      role: roleFor(room, user),
    });
    return { token, url };
  }

  // --- Host moderation (docs/modules/14 §3). Only the room host may act. ---

  /** Mute one participant's microphone (host cannot un-mute; they may unmute themselves). */
  async hostMute(roomId: string, identity: string, user: AuthUser): Promise<void> {
    const room = await this.requireHost(roomId, user);
    this.requireLivekit();
    await this.livekit.muteParticipantAudio(room.livekitRoom, identity);
    this.audit.log({
      action: 'meet.host.muted',
      actorId: user.id,
      entityType: 'meet_room',
      entityId: room.id,
      meta: { identity },
    });
  }

  /** Mute everyone's microphone except the host. */
  async hostMuteAll(roomId: string, user: AuthUser): Promise<void> {
    const room = await this.requireHost(roomId, user);
    this.requireLivekit();
    await this.livekit.muteAllExcept(room.livekitRoom, user.id);
    this.audit.log({
      action: 'meet.host.muted_all',
      actorId: user.id,
      entityType: 'meet_room',
      entityId: room.id,
    });
  }

  /** Remove (kick) a participant from the call. */
  async hostRemove(roomId: string, identity: string, user: AuthUser): Promise<void> {
    const room = await this.requireHost(roomId, user);
    this.requireLivekit();
    await this.livekit.removeParticipant(room.livekitRoom, identity);
    this.audit.log({
      action: 'meet.host.removed',
      actorId: user.id,
      entityType: 'meet_room',
      entityId: room.id,
      meta: { identity },
    });
  }

  /** End the call for everyone and mark the room inactive (a new open() then starts a fresh room). */
  async hostEnd(roomId: string, user: AuthUser): Promise<void> {
    const room = await this.requireHost(roomId, user);
    if (this.livekit.enabled) await this.livekit.endRoom(room.livekitRoom);
    await this.db
      .update(meetRooms)
      .set({ isActive: false })
      .where(and(eq(meetRooms.id, room.id), eq(meetRooms.isActive, true)));
    this.audit.log({
      action: 'meet.room.ended',
      actorId: user.id,
      entityType: 'meet_room',
      entityId: room.id,
    });
  }

  /** Load a room and assert the caller is its host (docs/modules/14 §1: creator = host). */
  private async requireHost(roomId: string, user: AuthUser): Promise<MeetRoomRow> {
    const room = await this.requireRoomById(roomId);
    if (room.createdBy !== user.id) {
      throw AppException.forbidden('meet.room.not_host', 'Only the host can moderate this call');
    }
    return room;
  }

  private requireLivekit(): void {
    if (!this.livekit.enabled) {
      throw AppException.serviceUnavailable('meet.unavailable', 'Calls are not configured');
    }
  }

  private async openAdhoc(user: AuthUser): Promise<MeetRoomDto> {
    const roomId = uuidv7();
    await this.db.insert(meetRooms).values({
      id: roomId,
      slug: newSlug(),
      kind: 'adhoc',
      channelId: null,
      access: 'link', // a permanent shareable link (docs/modules/14 §2)
      livekitRoom: `meet-${roomId}`,
      createdBy: user.id,
    });
    this.audit.log({
      action: 'meet.room.started',
      actorId: user.id,
      entityType: 'meet_room',
      entityId: roomId,
      meta: { kind: 'adhoc' },
    });
    return this.toDto(await this.requireRoomById(roomId), user);
  }

  /** Join eligibility, per {@link roomAccessRule}: channel/DM rooms are members-only; `link` rooms are
   *  open to any platform user (the `meet.use` guard already ran); an `invited` room with no channel is
   *  creator-only until the lobby lands (task 6.3+). */
  private async assertCanAccess(room: MeetRoomRow, user: AuthUser): Promise<void> {
    const rule = roomAccessRule(room);
    if (rule === 'any') return;
    if (rule === 'channel-member') {
      await this.assertChannelMember(room.channelId as string, user.id);
      return;
    }
    // 'creator-only'
    if (room.createdBy !== user.id) {
      throw AppException.forbidden('meet.room.forbidden', 'Not allowed to join this room');
    }
  }

  private async assertChannelMember(channelId: string, userId: string): Promise<void> {
    const [channel] = await this.db
      .select({ id: chatChannels.id })
      .from(chatChannels)
      .where(and(eq(chatChannels.id, channelId), isNull(chatChannels.deletedAt)))
      .limit(1);
    if (!channel) throw AppException.notFound('meet.channel.not_found', 'Channel not found');
    const [member] = await this.db
      .select({ id: chatMembers.id })
      .from(chatMembers)
      .where(and(eq(chatMembers.channelId, channelId), eq(chatMembers.userId, userId)))
      .limit(1);
    if (!member) {
      throw AppException.forbidden('meet.channel.forbidden', 'Not a member of this channel');
    }
  }

  private async requireRoomById(id: string): Promise<MeetRoomRow> {
    const [room] = await this.db.select().from(meetRooms).where(eq(meetRooms.id, id)).limit(1);
    if (!room) throw AppException.notFound('meet.room.not_found', 'Room not found');
    return room;
  }

  private async avatarOf(userId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ avatarFileId: users.avatarFileId })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return row?.avatarFileId ?? null;
  }

  private toDto(room: MeetRoomRow, user: AuthUser): MeetRoomDto {
    return {
      id: room.id,
      slug: room.slug,
      kind: room.kind,
      channelId: room.channelId,
      access: room.access,
      isActive: room.isActive,
      myRole: roleFor(room, user),
      createdBy: room.createdBy,
      createdAt: room.createdAt.toISOString(),
    };
  }
}

/** The room creator is the host (docs/modules/14 §1: «создатель/назначенный»); everyone else joins
 *  as a participant. Assigned/transferred host is a room-control action for a later task. */
function roleFor(room: MeetRoomRow, user: AuthUser): MeetRoomRole {
  return room.createdBy === user.id ? 'host' : 'participant';
}

/**
 * Who may join a room, as a pure decision (docs/modules/14 §2/§5):
 *  - `channel-member` — a DM/channel call: only that conversation's members;
 *  - `any` — an ad-hoc `link` room: any platform user with `meet.use` and the link;
 *  - `creator-only` — an `invited` room with no channel: only its creator, until the lobby (6.3+).
 */
export function roomAccessRule(room: {
  channelId: string | null;
  access: 'link' | 'invited';
}): 'channel-member' | 'any' | 'creator-only' {
  if (room.channelId) return 'channel-member';
  if (room.access === 'link') return 'any';
  return 'creator-only';
}

/** An opaque, collision-resistant slug for the shareable room URL (64 bits of randomness). */
function newSlug(): string {
  return randomBytes(8).toString('hex');
}
