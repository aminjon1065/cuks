import type { ChannelListItemDto, MessageDto } from '@cuks/shared';
import { formatDate } from '@/lib/format';

/** Consecutive messages from the same author within this window render under one header. */
const AUTHOR_RUN_MS = 5 * 60 * 1000;

/** A row in the virtualized feed: a day separator, the «Новые» divider, or a message. */
export type FeedRow =
  | { type: 'day'; key: string; day: string; iso: string }
  | { type: 'new'; key: string }
  | { type: 'message'; key: string; message: MessageDto; showAuthor: boolean };

export interface FeedRowOptions {
  /** The caller's read anchor captured when the channel was OPENED (docs/modules/13 §4) — the «Новые»
   *  divider goes before the first later message from someone else. Null = never read anything;
   *  undefined = anchor unknown yet, no divider. */
  lastReadId?: string | null | undefined;
  /** The caller — their own messages never count as «new». */
  meId?: string | undefined;
}

/** True when `m` is unread relative to the anchor: a real (non-optimistic) message from someone else,
 *  newer than the anchor. Message ids are uuidv7, so string order matches time order. */
function isUnread(m: MessageDto, lastReadId: string | null, meId: string | undefined): boolean {
  if (m.authorId === meId || m.id.startsWith('temp-')) return false;
  return lastReadId === null || m.id > lastReadId;
}

/**
 * Flatten chronological messages into feed rows (docs/modules/13 §7): a day separator whenever the
 * calendar day (Asia/Dushanbe) changes, an author header on the first message of each author-run
 * (author change or a gap longer than {@link AUTHOR_RUN_MS}), and — when a read anchor is supplied —
 * a single «Новые» divider before the first unread message. A flat row list virtualizes cleanly.
 */
export function buildFeedRows(messages: MessageDto[], options?: FeedRowOptions): FeedRow[] {
  const rows: FeedRow[] = [];
  const withDivider = options?.lastReadId !== undefined;
  let dividerPlaced = false;
  let lastDay: string | null = null;
  let lastAuthor: string | null = null;
  let lastTime = 0;
  for (const m of messages) {
    const day = formatDate(m.createdAt);
    if (day !== lastDay) {
      rows.push({ type: 'day', key: `day-${day}`, day, iso: m.createdAt });
      lastDay = day;
      lastAuthor = null;
      lastTime = 0;
    }
    if (withDivider && !dividerPlaced && isUnread(m, options.lastReadId ?? null, options.meId)) {
      rows.push({ type: 'new', key: 'new-divider' });
      dividerPlaced = true;
      lastAuthor = null;
      lastTime = 0;
    }
    const time = new Date(m.createdAt).getTime();
    const showAuthor = m.authorId !== lastAuthor || time - lastTime > AUTHOR_RUN_MS;
    rows.push({ type: 'message', key: m.id, message: m, showAuthor });
    lastAuthor = m.authorId;
    lastTime = time;
  }
  return rows;
}

export interface ChannelSections {
  pinned: ChannelListItemDto[];
  channels: ChannelListItemDto[];
  personal: ChannelListItemDto[];
}

/** Split conversations into the sidebar's Pinned / Channels / Personal sections (docs/modules/13 §7).
 *  Pinned is cross-cutting; the rest split by kind (dm/group → Personal, everything else → Channels). */
export function sectionChannels(items: ChannelListItemDto[]): ChannelSections {
  const pinned: ChannelListItemDto[] = [];
  const channels: ChannelListItemDto[] = [];
  const personal: ChannelListItemDto[] = [];
  for (const c of items) {
    if (c.isPinned) pinned.push(c);
    else if (c.kind === 'dm' || c.kind === 'group') personal.push(c);
    else channels.push(c);
  }
  return { pinned, channels, personal };
}

/** A conversation's display name — DMs/groups have no name, so join the other members' names. */
export function channelDisplayName(c: ChannelListItemDto, fallback: string): string {
  if (c.name) return c.name;
  const names = c.otherMembers.map((m) => m.name).filter((n): n is string => !!n);
  return names.length ? names.join(', ') : fallback;
}

/** Two-letter initials for an avatar fallback. */
export function initials(name: string | null | undefined): string {
  if (!name) return '—';
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? '').join('') || '—';
}
