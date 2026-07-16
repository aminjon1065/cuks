import { describe, expect, it, vi } from 'vitest';
import { MessagesService } from './messages.service';
import type { ChatAclService } from './chat-acl.service';
import type { AuditService } from '../../common/audit/audit.service';
import type { RealtimeService } from '../events/realtime.service';
import type { AuthUser } from '../../common/auth/auth-user';

const CHANNEL = '01900000-0000-7000-8000-0000000000c0';
const actor = { id: '01900000-0000-7000-8000-00000000000a', shortName: 'Иванов И.' } as AuthUser;

const acl = { requireMember: vi.fn(async () => ({ id: CHANNEL })) } as unknown as ChatAclService;
const audit = { log: vi.fn() } as unknown as AuditService;
const realtime = { emitToRoom: vi.fn() } as unknown as RealtimeService;

/** A db whose select chain resolves to `rows` and whose insert/update are inert. */
function makeDb(rows: unknown[]) {
  const chain: Record<string, unknown> = {
    select: () => chain,
    from: () => chain,
    leftJoin: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: () => chain,
    then: (resolve: (v: unknown[]) => void) => resolve(rows),
  };
  return chain as never;
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
    const svc = new MessagesService(makeDb([]), acl, audit, realtime);
    await expect(
      svc.send(CHANNEL, { kind: 'text', body: null, fileIds: [] }, actor),
    ).rejects.toMatchObject({ code: 'chat.message.empty' });
  });

  it('rejects a file message with no files', async () => {
    const svc = new MessagesService(makeDb([]), acl, audit, realtime);
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
    const svc = new MessagesService(makeDb(rows), acl, audit, realtime);
    const page = await svc.list(CHANNEL, { limit: 2 }, actor);
    expect(page.items).toHaveLength(2);
    expect(page.nextCursor).toBeTruthy();
  });

  it('has no next cursor when the page is not full', async () => {
    const rows = [msgRow('01900000-0000-7000-8000-000000000001', '2026-07-16T10:00:01.000Z')];
    const svc = new MessagesService(makeDb(rows), acl, audit, realtime);
    const page = await svc.list(CHANNEL, { limit: 2 }, actor);
    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).toBeNull();
  });

  it('rejects a malformed cursor', async () => {
    // base64url of "abc" — decodes to a value with no `<iso>|<id>` separator.
    const bad = Buffer.from('abc').toString('base64url');
    const svc = new MessagesService(makeDb([]), acl, audit, realtime);
    await expect(svc.list(CHANNEL, { limit: 2, cursor: bad }, actor)).rejects.toMatchObject({
      code: 'chat.cursor.invalid',
    });
  });
});
