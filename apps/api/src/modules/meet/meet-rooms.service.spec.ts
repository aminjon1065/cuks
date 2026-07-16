import { describe, expect, it } from 'vitest';
import { roomAccessRule } from './meet-rooms.service';

/** The join-eligibility decision (docs/modules/14 §2/§5) — the security core of the room API. */
describe('roomAccessRule', () => {
  it('requires channel membership for any room bound to a conversation (dm/channel)', () => {
    expect(roomAccessRule({ channelId: 'c1', access: 'invited' })).toBe('channel-member');
    // A conversation binding always wins, even if the row is somehow marked link-access.
    expect(roomAccessRule({ channelId: 'c1', access: 'link' })).toBe('channel-member');
  });

  it('opens an ad-hoc link room to any platform user (meet.use holder)', () => {
    expect(roomAccessRule({ channelId: null, access: 'link' })).toBe('any');
  });

  it('restricts an invited room with no channel to its creator (until the lobby lands)', () => {
    expect(roomAccessRule({ channelId: null, access: 'invited' })).toBe('creator-only');
  });
});
