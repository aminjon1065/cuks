import { z } from 'zod';
import type { MeetRoomAccess, MeetRoomKind, MeetRoomRole } from '../enums/index';

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
