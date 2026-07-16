import { describe, expect, it, vi } from 'vitest';
import { MessagesService } from './messages.service';
import type { ChatAclService } from './chat-acl.service';
import type { AuditService } from '../../common/audit/audit.service';
import type { RealtimeService } from '../events/realtime.service';
import type { ChatNotificationsService } from './chat-notifications.service';
import type { AuthUser } from '../../common/auth/auth-user';

const CHANNEL = '01900000-0000-7000-8000-0000000000c0';
const actor = { id: '01900000-0000-7000-8000-00000000000a', shortName: 'Иванов И.' } as AuthUser;

const acl = { requireMember: vi.fn(async () => ({ id: CHANNEL })) } as unknown as ChatAclService;
const audit = { log: vi.fn() } as unknown as AuditService;
const realtime = { emitToRoom: vi.fn() } as unknown as RealtimeService;
const chatNotifications = { notifyForMessage: vi.fn() } as unknown as ChatNotificationsService;

/** A db whose message-select chain resolves to `rows`; the reaction/reply side-queries the 5.5 list
 *  issues resolve empty, and insert/update are inert. */
function makeDb(rows: unknown[]) {
  const makeChain = () => {
    // The reaction/pin aggregates are recognisable by their groupBy call and resolve empty.
    let aggregate = false;
    const chain: Record<string, unknown> = {
      select: () => chain,
      from: () => chain,
      leftJoin: () => chain,
      innerJoin: () => chain,
      where: () => chain,
      orderBy: () => chain,
      limit: () => chain,
      groupBy: () => {
        aggregate = true;
        return chain;
      },
      then: (resolve: (v: unknown[]) => void) => resolve(aggregate ? [] : rows),
    };
    return chain;
  };
  // Each query starts a fresh chain so groupBy on one doesn't leak into the next.
  return { select: () => makeChain() } as never;
}

function msgRow(id: string, createdAt: string) {
  return {
    msg: {
      id,
      channelId: CHANNEL,
      authorId: actor.id,
      kind: 'text',
      body: { type: 'doc' },
      bodyText: 'hi',
      replyToId: null,
      fileIds: [],
      createdAt: new Date(createdAt),
      editedAt: null,
      deletedAt: null,
    },
    authorName: 'Иванов И.',
  };
}

describe('MessagesService.send — content validation (docs/modules/13 §5)', () => {
  it('rejects a text message with no body', async () => {
    const svc = new MessagesService(makeDb([]), acl, audit, realtime, chatNotifications);
    await expect(
      svc.send(CHANNEL, { kind: 'text', body: null, fileIds: [] }, actor),
    ).rejects.toMatchObject({ code: 'chat.message.empty' });
  });

  it('rejects a file message with no files', async () => {
    const svc = new MessagesService(makeDb([]), acl, audit, realtime, chatNotifications);
    await expect(
      svc.send(CHANNEL, { kind: 'file', body: null, fileIds: [] }, actor),
    ).rejects.toMatchObject({ code: 'chat.message.no_files' });
  });
});

describe('MessagesService.list — cursor paging (docs/modules/13 §5)', () => {
  it('returns a next cursor only when more than a page is available', async () => {
    // limit 2, but 3 rows come back → there is an older page.
    const rows = [
      msgRow('01900000-0000-7000-8000-000000000003', '2026-07-16T10:00:03.000Z'),
      msgRow('01900000-0000-7000-8000-000000000002', '2026-07-16T10:00:02.000Z'),
      msgRow('01900000-0000-7000-8000-000000000001', '2026-07-16T10:00:01.000Z'),
    ];
    const svc = new MessagesService(makeDb(rows), acl, audit, realtime, chatNotifications);
    const page = await svc.list(CHANNEL, { limit: 2 }, actor);
    expect(page.items).toHaveLength(2);
    expect(page.nextCursor).toBeTruthy();
  });

  it('has no next cursor when the page is not full', async () => {
    const rows = [msgRow('01900000-0000-7000-8000-000000000001', '2026-07-16T10:00:01.000Z')];
    const svc = new MessagesService(makeDb(rows), acl, audit, realtime, chatNotifications);
    const page = await svc.list(CHANNEL, { limit: 2 }, actor);
    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).toBeNull();
  });

  it('rejects a malformed cursor', async () => {
    // base64url of "abc" — decodes to a value with no `<iso>|<id>` separator.
    const bad = Buffer.from('abc').toString('base64url');
    const svc = new MessagesService(makeDb([]), acl, audit, realtime, chatNotifications);
    await expect(svc.list(CHANNEL, { limit: 2, cursor: bad }, actor)).rejects.toMatchObject({
      code: 'chat.cursor.invalid',
    });
  });
});

const MSG = '01900000-0000-7000-8000-0000000000f0';
const OTHER = '01900000-0000-7000-8000-00000000000b';

/** A db for the message-action paths: loadMessage returns `message`; reaction inserts return
 *  `insertReturns`; deletes are recorded. */
function makeActionsDb(
  message: Record<string, unknown> | null,
  insertReturns: unknown[] = [{ id: 'r1' }],
) {
  const deletes: string[] = [];
  const updates: Record<string, unknown>[] = [];
  const selectChain = () => {
    let aggregate = false;
    const chain: Record<string, unknown> = {
      select: () => chain,
      from: () => chain,
      leftJoin: () => chain,
      innerJoin: () => chain,
      where: () => chain,
      orderBy: () => chain,
      groupBy: () => {
        aggregate = true;
        return chain;
      },
      limit: () => chain,
      then: (resolve: (v: unknown[]) => void) => resolve(aggregate ? [] : message ? [message] : []),
    };
    return chain;
  };
  const db = {
    select: () => selectChain(),
    update: () => ({
      set: (v: Record<string, unknown>) => ({
        where: () => {
          updates.push(v);
          return Promise.resolve(undefined);
        },
      }),
    }),
    insert: () => ({
      values: () => ({
        onConflictDoNothing: () => ({ returning: () => Promise.resolve(insertReturns) }),
      }),
    }),
    delete: () => ({
      where: () => {
        deletes.push('del');
        return Promise.resolve(undefined);
      },
    }),
  };
  return { db: db as never, deletes, updates };
}

function makeAcl(role: 'owner' | 'admin' | 'member' | null = 'member') {
  return {
    requireMember: vi.fn(async () => ({ id: CHANNEL })),
    roleFor: vi.fn(async () => role),
  } as unknown as ChatAclService;
}

const textMsg = (over: Record<string, unknown> = {}) => ({
  id: MSG,
  channelId: CHANNEL,
  authorId: actor.id,
  kind: 'text',
  body: { type: 'doc' },
  bodyText: 'hi',
  replyToId: null,
  fileIds: [],
  createdAt: new Date('2026-07-16T10:00:00.000Z'),
  editedAt: null,
  deletedAt: null,
  ...over,
});

describe('MessagesService.edit — author + 24h window (docs/modules/13 §4)', () => {
  it('refuses a non-author', async () => {
    const { db } = makeActionsDb(textMsg({ authorId: OTHER }));
    const svc = new MessagesService(db, makeAcl(), audit, realtime, chatNotifications);
    await expect(svc.edit(MSG, { body: { type: 'doc' } }, actor)).rejects.toMatchObject({
      code: 'chat.message.not_author',
    });
  });

  it('refuses an edit past 24 hours', async () => {
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000);
    const { db } = makeActionsDb(textMsg({ createdAt: old }));
    const svc = new MessagesService(db, makeAcl(), audit, realtime, chatNotifications);
    await expect(svc.edit(MSG, { body: { type: 'doc' } }, actor)).rejects.toMatchObject({
      code: 'chat.message.edit_expired',
    });
  });

  it('edits within the window and stamps editedAt', async () => {
    const { db, updates } = makeActionsDb(textMsg({ createdAt: new Date() }));
    const svc = new MessagesService(db, makeAcl(), audit, realtime, chatNotifications);
    const dto = await svc.edit(
      MSG,
      {
        body: {
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }],
        },
      },
      actor,
    );
    expect(dto.editedAt).toBeTruthy();
    expect(updates[0]).toHaveProperty('editedAt');
  });
});

describe('MessagesService.remove — author or admin (docs/modules/13 §4)', () => {
  it('lets the author soft-delete', async () => {
    const { db, updates } = makeActionsDb(textMsg());
    const svc = new MessagesService(db, makeAcl(), audit, realtime, chatNotifications);
    await svc.remove(MSG, actor);
    expect(updates[0]).toHaveProperty('deletedAt');
  });

  it('refuses a non-author who is only a plain member', async () => {
    const { db } = makeActionsDb(textMsg({ authorId: OTHER }));
    const svc = new MessagesService(db, makeAcl('member'), audit, realtime, chatNotifications);
    await expect(svc.remove(MSG, actor)).rejects.toMatchObject({ code: 'chat.message.not_author' });
  });

  it('lets a channel admin delete someone else’s message', async () => {
    const { db, updates } = makeActionsDb(textMsg({ authorId: OTHER }));
    const svc = new MessagesService(db, makeAcl('admin'), audit, realtime, chatNotifications);
    await svc.remove(MSG, actor);
    expect(updates[0]).toHaveProperty('deletedAt');
  });
});

describe('MessagesService.toggleReaction (docs/modules/13 §4)', () => {
  it('adds when absent (insert returns a row) — no delete', async () => {
    const { db, deletes } = makeActionsDb(textMsg(), [{ id: 'r1' }]);
    const svc = new MessagesService(db, makeAcl(), audit, realtime, chatNotifications);
    await svc.toggleReaction(MSG, '👍', actor);
    expect(deletes).toHaveLength(0);
  });

  it('removes when present (insert no-ops) — deletes the row', async () => {
    const { db, deletes } = makeActionsDb(textMsg(), []);
    const svc = new MessagesService(db, makeAcl(), audit, realtime, chatNotifications);
    await svc.toggleReaction(MSG, '👍', actor);
    expect(deletes).toHaveLength(1);
  });
});
