import { z } from 'zod';
import {
  CHANNEL_MEMBER_ROLES,
  CHAT_NOTIFY_LEVELS,
  type ChannelKind,
  type ChannelMemberRole,
  type ChatMessageKind,
  type ChatNotifyLevel,
} from '../enums';

// --- Channels (docs/modules/13 §2/§3, task 5.2) ---

/** A person shown against a DM / channel. */
export interface ChatMemberDto {
  userId: string;
  name: string | null;
  role: ChannelMemberRole;
  notifyLevel: ChatNotifyLevel;
}

/** A conversation as it appears in the list — enough to render a row and its badge. */
export interface ChannelListItemDto {
  id: string;
  kind: ChannelKind;
  /** Null for DMs — the UI renders the other members' names instead. */
  name: string | null;
  topic: string | null;
  orgUnitId: string | null;
  isArchived: boolean;
  lastMessageAt: string | null;
  /** The caller's role, or null if they only see it via the public catalog. */
  myRole: ChannelMemberRole | null;
  /** The caller's personal bookmark — pinned conversations sort first (docs/modules/13 §7). */
  isPinned: boolean;
  memberCount: number;
  unreadCount: number;
  /** Unread messages that personally mention the caller — badged red (docs/modules/13 §4). */
  unreadMentions: number;
  /** For DM/group rendering: the members other than the caller. */
  otherMembers: { userId: string; name: string | null }[];
}

/** A channel opened in the reading pane — the list item plus its members and the caller's settings. */
export interface ChannelDto extends ChannelListItemDto {
  members: ChatMemberDto[];
  /** The caller's own notification level for this channel (for the info panel controls). */
  myNotifyLevel: ChatNotifyLevel;
  /** The caller's read anchor at fetch time — the «Новые» divider goes after it (docs/modules/13 §4). */
  myLastReadMessageId: string | null;
}

/** Sidebar totals across all the caller's conversations (docs/modules/13 §4). */
export interface ChatUnreadTotalsDto {
  unread: number;
  mentions: number;
}

/** Create a standalone public or private channel (not org/dm/incident — those are provisioned). */
export const createChannelSchema = z.object({
  kind: z.enum(['public', 'private']),
  name: z.string().trim().min(1).max(120),
  topic: z.string().trim().max(500).nullish(),
});
export type CreateChannelInput = z.infer<typeof createChannelSchema>;

export const updateChannelSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  topic: z.string().trim().max(500).nullish(),
});
export type UpdateChannelInput = z.infer<typeof updateChannelSchema>;

/** Open (or reuse) a direct / group conversation with the given users. */
export const createDmSchema = z.object({
  userIds: z.array(z.string().uuid()).min(1).max(19),
});
export type CreateDmInput = z.infer<typeof createDmSchema>;

export const addChannelMemberSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(CHANNEL_MEMBER_ROLES).default('member'),
});
export type AddChannelMemberInput = z.infer<typeof addChannelMemberSchema>;

/** Per-member channel settings (docs/modules/13 §3). */
export const updateMembershipSchema = z
  .object({
    notifyLevel: z.enum(CHAT_NOTIFY_LEVELS).optional(),
    isPinned: z.boolean().optional(),
  })
  .refine((v) => v.notifyLevel !== undefined || v.isPinned !== undefined, {
    message: 'nothing to update',
  });
export type UpdateMembershipInput = z.infer<typeof updateMembershipSchema>;

// --- Messages (docs/modules/13 §3/§5) ---

export interface MessageDto {
  id: string;
  channelId: string;
  authorId: string | null;
  authorName: string | null;
  kind: ChatMessageKind;
  body: unknown;
  bodyText: string | null;
  replyToId: string | null;
  fileIds: string[];
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
}

/** A page of messages (newest first) plus the cursor for the next older page. */
export interface MessagesPage {
  items: MessageDto[];
  nextCursor: string | null;
}

export const messagesQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type MessagesQuery = z.infer<typeof messagesQuerySchema>;

export const sendMessageSchema = z.object({
  kind: z.enum(['text', 'file']).default('text'),
  body: z.unknown().nullish(),
  replyToId: z.string().uuid().nullish(),
  fileIds: z.array(z.string().uuid()).max(20).default([]),
});
export type SendMessageInput = z.infer<typeof sendMessageSchema>;

export const markReadSchema = z.object({ messageId: z.string().uuid() });
export type MarkReadInput = z.infer<typeof markReadSchema>;
