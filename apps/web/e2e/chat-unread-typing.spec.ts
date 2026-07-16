import { expect, request, test, type APIRequestContext } from '@playwright/test';
import { io, type Socket } from 'socket.io-client';
import { apiLogin, csrfHeaders } from './support/api';
import { E2E_USER, STORAGE_STATE } from './support/fixtures';

/**
 * Task 5.4 e2e (docs/modules/13 §4): unread + mention counters and sidebar totals, the typing relay,
 * presence transitions, and the «Новые» divider + typing hint in the real feed UI.
 */
const API = 'http://localhost:3000';
const WS = `${API}/ws`;

const doc = (text: string) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});
const mentionDoc = (userId: string, label: string) => ({
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        { type: 'mention', attrs: { id: userId, label } },
        { type: 'text', text: ' взгляните' },
      ],
    },
  ],
});

async function j<T>(res: { json: () => Promise<unknown> }): Promise<T> {
  return (await res.json()) as T;
}
async function headers(ctx: APIRequestContext): Promise<Record<string, string>> {
  return { ...(await csrfHeaders(ctx)), 'content-type': 'application/json' };
}
async function cookieFor(ctx: APIRequestContext): Promise<string> {
  const s = (await ctx.storageState()).cookies.find((c) => c.name === 'cuks_session');
  expect(s, 'session cookie present').toBeTruthy();
  return `cuks_session=${s!.value}`;
}
function nextEvent<T>(socket: Socket, event: string, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), timeoutMs);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}
function subscribeChannel(socket: Socket, channelId: string): Promise<{ ok: boolean }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('subscribe timeout')), 3000);
    socket.emit('channel.subscribe', { channelId }, (ack: { ok: boolean }) => {
      clearTimeout(timer);
      resolve(ack);
    });
  });
}

/** Admin channel with e2e_user as a member; returns ids + the member context. */
async function seedChannel(admin: APIRequestContext, name: string) {
  const h = await headers(admin);
  const me = await j<{ id: string; shortName: string }>(await admin.get('/api/auth/me'));
  const channel = await j<{ id: string }>(
    await admin.post('/api/v1/chat/channels', { headers: h, data: { kind: 'private', name } }),
  );
  const member = await apiLogin(E2E_USER.username, E2E_USER.password);
  const memberMe = await j<{ id: string; shortName: string }>(await member.get('/api/auth/me'));
  await admin.post(`/api/v1/chat/channels/${channel.id}/members`, {
    headers: h,
    data: { userId: memberMe.id, role: 'member' },
  });
  return { me, channel, member, memberMe, h };
}

test('unread and mention counters flow into the list and sidebar totals', async () => {
  const admin = await request.newContext({ storageState: STORAGE_STATE, baseURL: API });
  const { me, channel, member, h } = await seedChannel(admin, `Счётчики ${Date.now()}`);
  const mh = await headers(member);
  try {
    // The member posts a plain message and one that mentions the admin.
    await member.post(`/api/v1/chat/channels/${channel.id}/messages`, {
      headers: mh,
      data: { kind: 'text', body: doc('просто сообщение') },
    });
    const mentioned = await j<{ id: string }>(
      await member.post(`/api/v1/chat/channels/${channel.id}/messages`, {
        headers: mh,
        data: { kind: 'text', body: mentionDoc(me.id, me.shortName) },
      }),
    );

    const list = await j<{ id: string; unreadCount: number; unreadMentions: number }[]>(
      await admin.get('/api/v1/chat/channels'),
    );
    const row = list.find((c) => c.id === channel.id);
    expect(row?.unreadCount).toBe(2);
    expect(row?.unreadMentions).toBe(1);

    const totals = await j<{ unread: number; mentions: number }>(
      await admin.get('/api/v1/chat/channels/unread-count'),
    );
    expect(totals.unread).toBeGreaterThanOrEqual(2);
    expect(totals.mentions).toBeGreaterThanOrEqual(1);

    // Reading up to the mention clears both counters for this channel.
    await admin.post(`/api/v1/chat/channels/${channel.id}/read`, {
      headers: h,
      data: { messageId: mentioned.id },
    });
    const after = await j<{ id: string; unreadCount: number; unreadMentions: number }[]>(
      await admin.get('/api/v1/chat/channels'),
    );
    const rowAfter = after.find((c) => c.id === channel.id);
    expect(rowAfter?.unreadCount).toBe(0);
    expect(rowAfter?.unreadMentions).toBe(0);
  } finally {
    await member.dispose();
    await admin.dispose();
  }
});

test('typing relays to channel subscribers but not the sender', async () => {
  const admin = await request.newContext({ storageState: STORAGE_STATE, baseURL: API });
  const { channel, member, memberMe } = await seedChannel(admin, `Тайпинг ${Date.now()}`);
  const adminSock = io(WS, {
    extraHeaders: { cookie: await cookieFor(admin) },
    transports: ['websocket'],
    forceNew: true,
  });
  const memberSock = io(WS, {
    extraHeaders: { cookie: await cookieFor(member) },
    transports: ['websocket'],
    forceNew: true,
  });
  try {
    await Promise.all([
      nextEvent(adminSock, 'connection.ready', 4000),
      nextEvent(memberSock, 'connection.ready', 4000),
    ]);
    const [a, b] = await Promise.all([
      subscribeChannel(adminSock, channel.id),
      subscribeChannel(memberSock, channel.id),
    ]);
    expect(a.ok && b.ok).toBe(true);

    const got = nextEvent<{ channelId: string; userId: string }>(adminSock, 'chat.typing', 3000);
    memberSock.emit('channel.typing', { channelId: channel.id });
    const payload = await got;
    expect(payload).toEqual({ channelId: channel.id, userId: memberMe.id });
  } finally {
    adminSock.disconnect();
    memberSock.disconnect();
    await member.dispose();
    await admin.dispose();
  }
});

test('presence turns online with a socket and offline after disconnect', async () => {
  const admin = await request.newContext({ storageState: STORAGE_STATE, baseURL: API });
  const member = await apiLogin(E2E_USER.username, E2E_USER.password);
  const memberMe = await j<{ id: string }>(await member.get('/api/auth/me'));
  const sock = io(WS, {
    extraHeaders: { cookie: await cookieFor(member) },
    transports: ['websocket'],
    forceNew: true,
  });
  try {
    await nextEvent(sock, 'connection.ready', 4000);
    const online = await j<{ userId: string; status: string }[]>(
      await admin.get(`/api/v1/presence?userIds=${memberMe.id}`),
    );
    expect(online[0]).toMatchObject({ userId: memberMe.id, status: 'online' });

    sock.disconnect();
    await expect
      .poll(
        async () => {
          const res = await j<{ status: string }[]>(
            await admin.get(`/api/v1/presence?userIds=${memberMe.id}`),
          );
          return res[0]?.status;
        },
        { timeout: 5000 },
      )
      .toBe('offline');
  } finally {
    sock.disconnect();
    await member.dispose();
    await admin.dispose();
  }
});

test('feed UI shows the «Новые» divider and a typing hint', async ({ page }) => {
  const admin = await request.newContext({ storageState: STORAGE_STATE, baseURL: API });
  const { channel, member, memberMe, h } = await seedChannel(admin, `Новые ${Date.now()}`);
  const mh = await headers(member);
  let memberSock: Socket | undefined;
  try {
    // History: my message (read) → the member's message (unread) — the divider goes between them.
    const first = await j<{ id: string }>(
      await admin.post(`/api/v1/chat/channels/${channel.id}/messages`, {
        headers: h,
        data: { kind: 'text', body: doc('прочитанное') },
      }),
    );
    await admin.post(`/api/v1/chat/channels/${channel.id}/read`, {
      headers: h,
      data: { messageId: first.id },
    });
    await member.post(`/api/v1/chat/channels/${channel.id}/messages`, {
      headers: mh,
      data: { kind: 'text', body: doc('непрочитанное от коллеги') },
    });

    await page.goto(`/app/chat/${channel.id}`);
    await expect(page.getByText('непрочитанное от коллеги')).toBeVisible();
    await expect(page.getByText('Новые сообщения')).toBeVisible();

    // A member typing over WS surfaces the hint under the feed.
    memberSock = io(WS, {
      extraHeaders: { cookie: await cookieFor(member) },
      transports: ['websocket'],
      forceNew: true,
    });
    await nextEvent(memberSock, 'connection.ready', 4000);
    expect((await subscribeChannel(memberSock, channel.id)).ok).toBe(true);
    const typer = memberSock;
    const interval = setInterval(
      () => typer.emit('channel.typing', { channelId: channel.id }),
      1000,
    );
    try {
      await expect(page.getByText(`${memberMe.shortName} печатает…`)).toBeVisible({
        timeout: 5000,
      });
    } finally {
      clearInterval(interval);
    }
  } finally {
    memberSock?.disconnect();
    await member.dispose();
    await admin.dispose();
  }
});
