import { z } from 'zod';
import type { MeetingStatus, MeetRoomAccess, MeetRoomKind, MeetRoomRole } from '../enums/index';

/**
 * Meet DTOs (docs/modules/14 §7, task 6.2). The room-creation endpoint opens a call room for a DM,
 * a channel, or an ad-hoc «new meeting» link. Scheduled meetings (kind `meeting`) are created by the
 * meetings API (task 6.5), not here.
 */
export const createRoomSchema = z.object({
  kind: z.enum(['dm', 'channel', 'adhoc']),
  // Required for `dm`/`channel` (the conversation the call belongs to); ignored for `adhoc`.
  channelId: z.string().uuid().nullish(),
});
export type CreateRoomInput = z.infer<typeof createRoomSchema>;

/** A call room as the client sees it. `myRole` reflects the caller's authority in this room. */
export interface MeetRoomDto {
  id: string;
  slug: string;
  kind: MeetRoomKind;
  channelId: string | null;
  access: MeetRoomAccess;
  isActive: boolean;
  myRole: MeetRoomRole;
  createdBy: string | null;
  createdAt: string;
}

/** What the browser needs to join a LiveKit room: the signed token + the SFU WebSocket URL. */
export interface MeetTokenDto {
  token: string;
  url: string;
}

/** Host moderation target (docs/modules/14 §3): the LiveKit identity (= user id) to mute/remove. */
export const meetHostTargetSchema = z.object({
  identity: z.string().min(1),
});
export type MeetHostTargetInput = z.infer<typeof meetHostTargetSchema>;

/** Ring a user for a 1:1 DM call (docs/modules/14 §2/§7): `roomId` is the DM's room, `userId` the
 *  recipient (the other DM member). */
export const startRingSchema = z.object({
  roomId: z.string().uuid(),
  userId: z.string().uuid(),
  media: z.enum(['audio', 'video']).default('video'),
});
export type StartRingInput = z.infer<typeof startRingSchema>;

/** The lifecycle event a `kind: 'call'` chat message records (docs/modules/14 §2). */
export type MeetCallEvent = 'started' | 'ended' | 'missed' | 'declined';

/** Body of a call system message (stored in `chat_messages.body`, rendered as a call card). */
export interface MeetCallMessageBody {
  call: MeetCallEvent;
  media: 'audio' | 'video';
  roomId: string;
  slug: string;
  /** Set on `ended` — the call's length in seconds (docs/modules/14 §9). */
  durationSec?: number;
}

/** An in-progress call on a channel, for the «Идёт звонок» banner (docs/modules/14 §2). */
export interface MeetActiveCallDto {
  roomId: string;
  slug: string;
}

// --- Scheduled meetings (docs/modules/14 §2/§5/§7, task 6.5) ---

/** Who is invited to a meeting: explicit users and/or whole org units (docs/modules/14 §5). */
export const meetingParticipantsSchema = z.object({
  users: z.array(z.string().uuid()).max(500).default([]),
  orgUnits: z.array(z.string().uuid()).max(100).default([]),
});
export type MeetingParticipants = z.infer<typeof meetingParticipantsSchema>;

/** Schedule a meeting (docs/modules/14 §2): theme, time, duration, invitees, agenda, record flag. */
export const createMeetingSchema = z.object({
  title: z.string().trim().min(1).max(200),
  agenda: z.string().trim().max(4000).nullish(),
  startsAt: z.string().datetime(),
  durationMin: z.number().int().min(5).max(600).default(60),
  participants: meetingParticipantsSchema.default({ users: [], orgUnits: [] }),
  recordPlanned: z.boolean().default(false),
});
export type CreateMeetingInput = z.infer<typeof createMeetingSchema>;

/** Edit or cancel a meeting (organizer only). Any field may be updated; `status: cancelled` cancels. */
export const updateMeetingSchema = createMeetingSchema
  .partial()
  .extend({ status: z.enum(['scheduled', 'cancelled']).optional() });
export type UpdateMeetingInput = z.infer<typeof updateMeetingSchema>;

/** «Встречи» list segments (docs/modules/14 §2): today, upcoming, or past. */
export const meetingsRangeSchema = z.enum(['today', 'upcoming', 'past']);
export type MeetingsRange = z.infer<typeof meetingsRangeSchema>;

export interface MeetingDto {
  id: string;
  roomId: string;
  slug: string;
  title: string;
  agenda: string | null;
  startsAt: string;
  durationMin: number;
  organizerId: string | null;
  organizerName: string | null;
  participants: MeetingParticipants;
  /** Display names for the explicitly-invited users — so the edit form can label their chips. */
  participantUsers: { id: string; name: string }[];
  /** Resolved headcount (explicit users + org-unit members, deduped) — for the card. */
  participantCount: number;
  recordPlanned: boolean;
  status: MeetingStatus;
  /** The caller organizes this meeting (may edit / cancel). */
  canManage: boolean;
}
