import { describe, expect, it } from 'vitest';
import type { ChannelListItemDto, MessageDto } from '@cuks/shared';
import { buildFeedRows, channelDisplayName, initials, sectionChannels } from './grouping';

function msg(over: Partial<MessageDto>): MessageDto {
  return {
    id: 'm',
    channelId: 'c',
    authorId: 'a',
    authorName: 'A',
    kind: 'text',
    body: null,
    bodyText: 'hi',
    replyToId: null,
    replyTo: null,
    reactions: [],
    fileIds: [],
    createdAt: '2026-07-16T06:00:00.000Z',
    editedAt: null,
    deletedAt: null,
    ...over,
  };
}

function channel(over: Partial<ChannelListItemDto>): ChannelListItemDto {
  return {
    id: 'c',
    kind: 'public',
    name: 'General',
    topic: null,
    orgUnitId: null,
    isArchived: false,
    lastMessageAt: null,
    myRole: 'member',
    isPinned: false,
    memberCount: 1,
    unreadCount: 0,
    unreadMentions: 0,
    otherMembers: [],
    ...over,
  };
}

describe('buildFeedRows (docs/modules/13 §7)', () => {
  it('returns no rows for no messages', () => {
    expect(buildFeedRows([])).toEqual([]);
  });

  it('emits one day separator and groups an author-run under a single header', () => {
    const rows = buildFeedRows([
      msg({ id: 'm1', authorId: 'a', createdAt: '2026-07-16T06:00:00.000Z' }),
      msg({ id: 'm2', authorId: 'a', createdAt: '2026-07-16T06:03:00.000Z' }),
    ]);
    expect(rows.map((r) => r.type)).toEqual(['day', 'message', 'message']);
    expect(rows[1]).toMatchObject({ type: 'message', showAuthor: true });
    expect(rows[2]).toMatchObject({ type: 'message', showAuthor: false });
  });

  it('starts a new header when the author changes', () => {
    const rows = buildFeedRows([
      msg({ id: 'm1', authorId: 'a', createdAt: '2026-07-16T06:00:00.000Z' }),
      msg({ id: 'm2', authorId: 'b', createdAt: '2026-07-16T06:01:00.000Z' }),
    ]);
    expect(rows[2]).toMatchObject({ type: 'message', showAuthor: true });
  });

  it('starts a new header after a gap longer than five minutes', () => {
    const rows = buildFeedRows([
      msg({ id: 'm1', authorId: 'a', createdAt: '2026-07-16T06:00:00.000Z' }),
      msg({ id: 'm2', authorId: 'a', createdAt: '2026-07-16T06:06:00.000Z' }),
    ]);
    expect(rows[2]).toMatchObject({ type: 'message', showAuthor: true });
  });

  it('inserts a day separator when the calendar day changes', () => {
    const rows = buildFeedRows([
      msg({ id: 'm1', createdAt: '2026-07-16T06:00:00.000Z' }),
      msg({ id: 'm2', createdAt: '2026-07-17T06:00:00.000Z' }),
    ]);
    expect(rows.filter((r) => r.type === 'day')).toHaveLength(2);
  });
});

describe('buildFeedRows — the «Новые» divider (docs/modules/13 §4)', () => {
  // uuidv7-like ordering: lexicographic id order matches time order.
  const older = msg({ id: 'a1', authorId: 'other', createdAt: '2026-07-16T06:00:00.000Z' });
  const newer = msg({ id: 'b2', authorId: 'other', createdAt: '2026-07-16T06:01:00.000Z' });

  it('goes before the first unread message from someone else', () => {
    const rows = buildFeedRows([older, newer], { lastReadId: 'a1', meId: 'me' });
    const types = rows.map((r) => r.type);
    expect(types).toEqual(['day', 'message', 'new', 'message']);
    // The message after the divider starts a fresh author header.
    expect(rows[3]).toMatchObject({ type: 'message', showAuthor: true });
  });

  it('marks everything unread when nothing was ever read', () => {
    const rows = buildFeedRows([older, newer], { lastReadId: null, meId: 'me' });
    expect(rows.map((r) => r.type)).toEqual(['day', 'new', 'message', 'message']);
  });

  it('shows no divider when everything is read, and never for my own or optimistic messages', () => {
    expect(
      buildFeedRows([older, newer], { lastReadId: 'b2', meId: 'me' }).some((r) => r.type === 'new'),
    ).toBe(false);
    const mine = msg({ id: 'c3', authorId: 'me', createdAt: '2026-07-16T06:02:00.000Z' });
    const temp = msg({ id: 'temp-x', authorId: 'other', createdAt: '2026-07-16T06:03:00.000Z' });
    expect(
      buildFeedRows([mine, temp], { lastReadId: null, meId: 'me' }).some((r) => r.type === 'new'),
    ).toBe(false);
  });

  it('shows no divider when the anchor is unknown (options omitted)', () => {
    expect(buildFeedRows([older, newer]).some((r) => r.type === 'new')).toBe(false);
  });

  it('is placed exactly once', () => {
    const third = msg({ id: 'c3', authorId: 'other', createdAt: '2026-07-16T06:02:00.000Z' });
    const rows = buildFeedRows([older, newer, third], { lastReadId: 'a1', meId: 'me' });
    expect(rows.filter((r) => r.type === 'new')).toHaveLength(1);
  });
});

describe('sectionChannels (docs/modules/13 §7)', () => {
  it('splits pinned out, and the rest by kind', () => {
    const items = [
      channel({ id: 'p', isPinned: true, kind: 'public' }),
      channel({ id: 'ch', kind: 'private' }),
      channel({ id: 'org', kind: 'org' }),
      channel({ id: 'dm', kind: 'dm' }),
      channel({ id: 'grp', kind: 'group' }),
    ];
    const s = sectionChannels(items);
    expect(s.pinned.map((c) => c.id)).toEqual(['p']);
    expect(s.channels.map((c) => c.id)).toEqual(['ch', 'org']);
    expect(s.personal.map((c) => c.id)).toEqual(['dm', 'grp']);
  });
});

describe('channelDisplayName', () => {
  it('uses the channel name when set', () => {
    expect(channelDisplayName(channel({ name: 'Ops' }), 'fallback')).toBe('Ops');
  });
  it('joins other members for an unnamed DM/group', () => {
    expect(
      channelDisplayName(
        channel({ name: null, kind: 'dm', otherMembers: [{ userId: 'u', name: 'Иванов И.' }] }),
        'fallback',
      ),
    ).toBe('Иванов И.');
  });
  it('falls back when there are no names', () => {
    expect(channelDisplayName(channel({ name: null, otherMembers: [] }), 'fallback')).toBe(
      'fallback',
    );
  });
});

describe('initials', () => {
  it('takes the first letter of up to two words', () => {
    expect(initials('Иванов Иван')).toBe('ИИ');
    expect(initials('General')).toBe('G');
    expect(initials(null)).toBe('—');
  });
});
