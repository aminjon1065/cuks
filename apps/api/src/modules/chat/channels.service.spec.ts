import { describe, expect, it, vi } from 'vitest';
import { ChannelsService } from './channels.service';
import type { ChatAclService } from './chat-acl.service';
import type { AuditService } from '../../common/audit/audit.service';
import type { RealtimeService } from '../events/realtime.service';
import type { AuthUser } from '../../common/auth/auth-user';
import type { ChannelKind, ChannelMemberRole } from '@cuks/shared';

const CHANNEL = '01900000-0000-7000-8000-0000000000c0';
const ACTOR = '01900000-0000-7000-8000-00000000000a';
const OTHER = '01900000-0000-7000-8000-00000000000b';
const actor = { id: ACTOR } as AuthUser;

const audit = { log: vi.fn() } as unknown as AuditService;

/** db stub: each `select()` returns the next queued result set; `delete()` flags that it ran. */
function makeDb(selectResults: unknown[][]) {
  let i = 0;
  const rec = { deleted: false, inserted: false };
  const chain = (rows: unknown[]): Record<string, unknown> => {
    const c: Record<string, unknown> = {
      from: () => c,
      where: () => c,
      limit: () => c,
      leftJoin: () => c,
      innerJoin: () => c,
      orderBy: () => c,
      groupBy: () => c,
      then: (resolve: (v: unknown[]) => void) => resolve(rows),
    };
    return c;
  };
  const db = {
    select: () => chain(selectResults[i++] ?? []),
    insert: () => ({
      values: () => ({ onConflictDoNothing: () => ((rec.inserted = true), Promise.resolve()) }),
    }),
    delete: () => ({ where: () => ((rec.deleted = true), Promise.resolve()) }),
  };
  return { db: db as never, rec };
}

function makeAcl(kind: ChannelKind, roles: Record<string, ChannelMemberRole>) {
  return {
    loadChannel: vi.fn(async () => ({ id: CHANNEL, kind })),
    roleFor: vi.fn(async (_c: string, uid: string) => roles[uid] ?? null),
    requireMember: vi.fn(async () => ({ id: CHANNEL, kind })),
  } as unknown as ChatAclService;
}

const realtime = () => ({ emitToRoom: vi.fn() }) as unknown as RealtimeService;

describe('ChannelsService.removeMember — rank + last-owner + kind guards (docs/modules/13 §1/§2)', () => {
  it('refuses an admin evicting the owner (cannot remove equal-or-higher rank)', async () => {
    const { db } = makeDb([]);
    const svc = new ChannelsService(
      db,
      makeAcl('private', { [ACTOR]: 'admin', [OTHER]: 'owner' }),
      audit,
      realtime(),
    );
    await expect(svc.removeMember(CHANNEL, OTHER, actor)).rejects.toMatchObject({
      code: 'chat.channel.cannot_remove_peer',
    });
  });

  it('refuses the last owner leaving (would orphan the channel)', async () => {
    // self-leave; assertNotLastOwner sees target=owner then owner-count=1.
    const { db } = makeDb([[{ role: 'owner' }], [{ n: 1 }]]);
    const svc = new ChannelsService(
      db,
      makeAcl('private', { [ACTOR]: 'owner' }),
      audit,
      realtime(),
    );
    await expect(svc.removeMember(CHANNEL, ACTOR, actor)).rejects.toMatchObject({
      code: 'chat.channel.last_owner',
    });
  });

  it('lets an owner remove a plain member', async () => {
    const { db, rec } = makeDb([[{ role: 'member' }]]); // target is a member → last-owner check passes
    const svc = new ChannelsService(
      db,
      makeAcl('private', { [ACTOR]: 'owner', [OTHER]: 'member' }),
      audit,
      realtime(),
    );
    await svc.removeMember(CHANNEL, OTHER, actor);
    expect(rec.deleted).toBe(true);
  });

  it('refuses membership changes on a DM (fixed pair)', async () => {
    const { db } = makeDb([]);
    const svc = new ChannelsService(db, makeAcl('dm', { [ACTOR]: 'owner' }), audit, realtime());
    await expect(svc.removeMember(CHANNEL, OTHER, actor)).rejects.toMatchObject({
      code: 'chat.channel.membership_locked',
    });
  });
});

describe('ChannelsService.addMember — role clamp + kind guard (docs/modules/13 §1/§2)', () => {
  it('refuses an admin granting a role above their own (owner)', async () => {
    const { db } = makeDb([]);
    const svc = new ChannelsService(
      db,
      makeAcl('private', { [ACTOR]: 'admin' }),
      audit,
      realtime(),
    );
    await expect(
      svc.addMember(CHANNEL, { userId: OTHER, role: 'owner' }, actor),
    ).rejects.toMatchObject({ code: 'chat.channel.role_too_high' });
  });

  it('refuses adding to an org channel (membership is synced from personnel)', async () => {
    const { db } = makeDb([]);
    const svc = new ChannelsService(db, makeAcl('org', { [ACTOR]: 'owner' }), audit, realtime());
    await expect(
      svc.addMember(CHANNEL, { userId: OTHER, role: 'member' }, actor),
    ).rejects.toMatchObject({ code: 'chat.channel.membership_locked' });
  });
});
