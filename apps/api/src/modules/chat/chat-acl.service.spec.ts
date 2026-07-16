import { describe, expect, it } from 'vitest';
import { chatChannels, chatMembers } from '@cuks/db';
import type { ChannelMemberRole } from '@cuks/shared';
import { ChatAclService } from './chat-acl.service';
import type { AuthUser } from '../../common/auth/auth-user';
import { AppException } from '../../common/exceptions/app.exception';

const CHANNEL = '01900000-0000-7000-8000-0000000000c0';
const USER = '01900000-0000-7000-8000-00000000000a';

const actor = { id: USER } as AuthUser;

/** Chainable db stub: `chat_channels` reads return the channel (or nothing if soft-deleted/missing),
 *  `chat_members` reads return the caller's role row (or nothing if not a member). */
function makeDb(opts: { channel?: boolean; role?: ChannelMemberRole | null }) {
  const reader = () => {
    let table: unknown = null;
    const rowsFor = (): unknown[] => {
      if (table === chatChannels) return opts.channel === false ? [] : [{ id: CHANNEL }];
      if (table === chatMembers) return opts.role ? [{ role: opts.role }] : [];
      return [];
    };
    const chain: Record<string, unknown> = {
      from(t: unknown) {
        table = t;
        return chain;
      },
      where: () => chain,
      limit: () => chain,
      then: (resolve: (v: unknown[]) => void) => resolve(rowsFor()),
    };
    return chain;
  };
  return { select: reader } as never;
}

describe('ChatAclService (docs/modules/13 §1)', () => {
  it('loadChannel throws 404 when the channel is missing or soft-deleted', async () => {
    const acl = new ChatAclService(makeDb({ channel: false }));
    await expect(acl.loadChannel(CHANNEL)).rejects.toThrow(AppException);
    await expect(acl.loadChannel(CHANNEL)).rejects.toMatchObject({
      code: 'chat.channel.not_found',
    });
  });

  it('requireMember rejects a non-member with 403', async () => {
    const acl = new ChatAclService(makeDb({ role: null }));
    await expect(acl.requireMember(CHANNEL, actor)).rejects.toMatchObject({
      code: 'chat.channel.forbidden',
    });
  });

  it('requireMember admits a plain member for the default (member) floor', async () => {
    const acl = new ChatAclService(makeDb({ role: 'member' }));
    await expect(acl.requireMember(CHANNEL, actor)).resolves.toMatchObject({ id: CHANNEL });
  });

  it('requireMember rejects a member when admin is required', async () => {
    const acl = new ChatAclService(makeDb({ role: 'member' }));
    await expect(acl.requireMember(CHANNEL, actor, 'admin')).rejects.toMatchObject({
      code: 'chat.channel.forbidden',
    });
  });

  it('requireMember admits owner for an admin floor (owner outranks admin)', async () => {
    const acl = new ChatAclService(makeDb({ role: 'owner' }));
    await expect(acl.requireMember(CHANNEL, actor, 'admin')).resolves.toMatchObject({
      id: CHANNEL,
    });
  });

  it('roleFor returns the stored role, or null when not a member', async () => {
    await expect(
      new ChatAclService(makeDb({ role: 'admin' })).roleFor(CHANNEL, USER),
    ).resolves.toBe('admin');
    await expect(
      new ChatAclService(makeDb({ role: null })).roleFor(CHANNEL, USER),
    ).resolves.toBeNull();
  });
});
