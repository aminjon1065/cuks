import { describe, expect, it } from 'vitest';
import { chatMessageRecipients, type MemberNotify } from './chat-notifications.service';

const author = 'u-author';
const members: MemberNotify[] = [
  { userId: 'u-author', notifyLevel: 'all' },
  { userId: 'u-all', notifyLevel: 'all' },
  { userId: 'u-mentions', notifyLevel: 'mentions' },
  { userId: 'u-mute', notifyLevel: 'mute' },
];

function recipients(over: {
  channelKind?: 'public' | 'dm';
  mentioned?: string[];
  viewing?: string[];
}) {
  return chatMessageRecipients({
    channelKind: over.channelKind ?? 'public',
    authorId: author,
    members,
    mentionedIds: new Set(over.mentioned ?? []),
    viewingIds: new Set(over.viewing ?? []),
  });
}

describe('chatMessageRecipients (docs/modules/13 §6)', () => {
  it('never notifies the author, and never a muted member', () => {
    const r = recipients({ mentioned: ['u-author', 'u-mute'] });
    expect(r).not.toContain('u-author');
    expect(r).not.toContain('u-mute');
  });

  it('in a channel, notifies level=all always but level=mentions only when mentioned', () => {
    expect(recipients({})).toEqual(['u-all']); // mentions member not mentioned → skipped
    expect(recipients({ mentioned: ['u-mentions'] }).sort()).toEqual(['u-all', 'u-mentions']);
  });

  it('skips anyone currently viewing the channel', () => {
    expect(recipients({ viewing: ['u-all'] })).toEqual([]);
    expect(recipients({ mentioned: ['u-mentions'], viewing: ['u-mentions'] })).toEqual(['u-all']);
  });

  it('in a DM/group, notifies every non-author, non-muted member regardless of level', () => {
    // the mentions-level member gets notified in a DM even without a mention (a DM is direct).
    expect(recipients({ channelKind: 'dm' }).sort()).toEqual(['u-all', 'u-mentions']);
  });
});
