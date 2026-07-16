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
