import { z } from 'zod';
import type {
  MeetingStatus,
  MeetRoomAccess,
  MeetRoomKind,
  MeetRoomRole,
  RecordingStatus,
} from '../enums/index';

/** At most this many recordings may run at once (docs/modules/14 §4). */
export const MEET_MAX_CONCURRENT_RECORDINGS = 2;
/** Recordings are kept this long before the retention sweep deletes them (docs/modules/14 §4). */
export const MEET_RECORDING_RETENTION_DAYS = 180;
/** Presigned lifetime for the inline stream URL — long enough to watch a whole recording without the
 *  URL expiring mid-playback (the default 5-min download expiry is too short for a video). */
export const MEET_RECORDING_STREAM_URL_EXPIRY_SECONDS = 4 * 60 * 60;

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

// --- Recordings (docs/modules/14 §4/§7, task 6.6) ---

/** Start a recording (host + meet.record). Body carries an optional title override. */
export const startRecordingSchema = z.object({
  title: z.string().trim().max(200).nullish(),
});
export type StartRecordingInput = z.infer<typeof startRecordingSchema>;

/** A recording as the «Записи» list sees it. Access is gated server-side (participants + manage). */
export interface RecordingDto {
  id: string;
  roomId: string | null;
  meetingId: string | null;
  title: string;
  startedById: string | null;
  startedByName: string | null;
  status: RecordingStatus;
  /** Length in whole seconds (null until the egress completes). */
  durationSec: number | null;
  /** File size in bytes (null until ready). */
  sizeBytes: number | null;
  participantCount: number;
  createdAt: string;
  /** The caller may delete it (the host who started it, or meet.recordings.manage). */
  canManage: boolean;
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
