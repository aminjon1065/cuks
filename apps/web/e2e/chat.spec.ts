import { expect, request, test, type APIRequestContext } from '@playwright/test';
import { io, type Socket } from 'socket.io-client';
import { apiLogin, csrfHeaders } from './support/api';
import { E2E_USER, E2E_USER2, STORAGE_STATE } from './support/fixtures';

/**
 * Chat protocol e2e (docs/modules/13 §2/§5, task 5.2): channel creation, cursor-paged message
 * history, the membership gate on reads/posts, and live `chat.message.created` delivery to a
 * subscribed channel socket.
 */
const API = 'http://localhost:3000';
const WS = `${API}/ws`;

const doc = (text: string) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});

async function j<T>(res: { json: () => Promise<unknown> }): Promise<T> {
  return (await res.json()) as T;
}
async function headers(ctx: APIRequestContext): Promise<Record<string, string>> {
  return { ...(await csrfHeaders(ctx)), 'content-type': 'application/json' };
}
function cookieFor(state: { cookies: { name: string; value: string }[] }): string {
  const s = state.cookies.find((c) => c.name === 'cuks_session');
  expect(s, 'the session cookie is present').toBeTruthy();
  return `cuks_session=${s!.value}`;
}

/** Resolve with the next `event` payload, or reject after `timeoutMs`. */
function nextEvent<T>(socket: Socket, event: string, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), timeoutMs);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}
/** Emit `channel.subscribe` and await the server ack. */
function subscribeChannel(socket: Socket, channelId: string): Promise<{ ok: boolean }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('subscribe timeout')), 3000);
    socket.emit('channel.subscribe', { channelId }, (ack: { ok: boolean }) => {
      clearTimeout(timer);
      resolve(ack);
    });
  });
}

test('chat: create a channel, send messages and page the history newest-first', async () => {
  const admin = await request.newContext({ storageState: STORAGE_STATE, baseURL: API });
  const h = await headers(admin);
  try {
    const channel = await j<{ id: string; myRole: string; memberCount: number }>(
      await admin.post('/api/v1/chat/channels', {
        headers: h,
        data: { kind: 'private', name: `Chat ${Date.now()}` },
      }),
    );
    expect(channel.myRole, 'the creator is the owner').toBe('owner');
    expect(channel.memberCount).toBe(1);

    // Three messages, oldest → newest.
    const ids: string[] = [];
    for (const text of ['first', 'second', 'third']) {
      const msg = await j<{ id: string; bodyText: string }>(
        await admin.post(`/api/v1/chat/channels/${channel.id}/messages`, {
          headers: h,
          data: { kind: 'text', body: doc(text) },
        }),
      );
      expect(msg.bodyText).toBe(text);
      ids.push(msg.id);
    }

    // Page 1 (limit 2): newest first, with a cursor for the older page.
    const p1 = await j<{ items: { id: string }[]; nextCursor: string | null }>(
      await admin.get(`/api/v1/chat/channels/${channel.id}/messages?limit=2`),
    );
    expect(p1.items.map((m) => m.id)).toEqual([ids[2], ids[1]]);
    expect(p1.nextCursor).toBeTruthy();

    // Page 2 follows the cursor to the oldest message; no further page.
    const p2 = await j<{ items: { id: string }[]; nextCursor: string | null }>(
      await admin.get(
        `/api/v1/chat/channels/${channel.id}/messages?limit=2&cursor=${encodeURIComponent(p1.nextCursor!)}`,
      ),
    );
    expect(p2.items.map((m) => m.id)).toEqual([ids[0]]);
    expect(p2.nextCursor).toBeNull();

    // The channel surfaces in my conversations, bumped by the last message.
    const mine = await j<{ id: string; lastMessageAt: string | null }[]>(
      await admin.get('/api/v1/chat/channels'),
    );
    expect(mine.find((c) => c.id === channel.id)?.lastMessageAt).toBeTruthy();
  } finally {
    await admin.dispose();
  }
});

test('chat: a non-member is refused reads, posts and the channel room', async () => {
  const admin = await request.newContext({ storageState: STORAGE_STATE, baseURL: API });
  const h = await headers(admin);
  const outsider = await apiLogin(E2E_USER.username, E2E_USER.password);
  const oh = await headers(outsider);
  let socket: Socket | undefined;
  try {
    const channel = await j<{ id: string }>(
      await admin.post('/api/v1/chat/channels', {
        headers: h,
        data: { kind: 'private', name: `Private ${Date.now()}` },
      }),
    );

    const read = await outsider.get(`/api/v1/chat/channels/${channel.id}/messages`);
    expect(read.status()).toBe(403);
    expect((await j<{ error: { code: string } }>(read)).error.code).toBe('chat.channel.forbidden');

    const get = await outsider.get(`/api/v1/chat/channels/${channel.id}`);
    expect(get.status()).toBe(403);

    const post = await outsider.post(`/api/v1/chat/channels/${channel.id}/messages`, {
      headers: oh,
      data: { kind: 'text', body: doc('let me in') },
    });
    expect(post.status()).toBe(403);

    // The WS room is gated by the same membership rule.
    const cookie = cookieFor(await outsider.storageState());
    socket = io(WS, { extraHeaders: { cookie }, transports: ['websocket'], forceNew: true });
    await nextEvent(socket, 'connection.ready', 4000);
    const ack = await subscribeChannel(socket, channel.id);
    expect(ack.ok, 'a non-member cannot join the channel room').toBe(false);
  } finally {
    socket?.disconnect();
    await outsider.dispose();
    await admin.dispose();
  }
});

test('chat: a channel admin cannot evict the owner or grant a role above their own', async () => {
  const admin = await request.newContext({ storageState: STORAGE_STATE, baseURL: API });
  const h = await headers(admin);
  const chanAdmin = await apiLogin(E2E_USER.username, E2E_USER.password); // becomes a channel admin
  const bystander = await apiLogin(E2E_USER2.username, E2E_USER2.password);
  try {
    const ownerId = (await j<{ id: string }>(await admin.get('/api/auth/me'))).id;
    const chanAdminId = (await j<{ id: string }>(await chanAdmin.get('/api/auth/me'))).id;
    const bystanderId = (await j<{ id: string }>(await bystander.get('/api/auth/me'))).id;

    const channel = await j<{ id: string }>(
      await admin.post('/api/v1/chat/channels', {
        headers: h,
        data: { kind: 'private', name: `Guarded ${Date.now()}` },
      }),
    );
    // The owner promotes E2E_USER to admin — allowed (admin <= owner).
    const promote = await admin.post(`/api/v1/chat/channels/${channel.id}/members`, {
      headers: h,
      data: { userId: chanAdminId, role: 'admin' },
    });
    expect(promote.ok(), 'owner may grant admin').toBeTruthy();

    const ah = await headers(chanAdmin);
    // The admin cannot delete the owner (equal-or-higher rank). A bodyless DELETE must not carry a JSON
    // content-type (Fastify would 400 on the empty body) — send the csrf header only.
    const evict = await chanAdmin.delete(`/api/v1/chat/channels/${channel.id}/members/${ownerId}`, {
      headers: await csrfHeaders(chanAdmin),
    });
    expect(evict.status()).toBe(403);
    expect((await j<{ error: { code: string } }>(evict)).error.code).toBe(
      'chat.channel.cannot_remove_peer',
    );

    // The admin cannot mint an owner (a role above their own).
    const escalate = await chanAdmin.post(`/api/v1/chat/channels/${channel.id}/members`, {
      headers: ah,
      data: { userId: bystanderId, role: 'owner' },
    });
    expect(escalate.status()).toBe(403);
    expect((await j<{ error: { code: string } }>(escalate)).error.code).toBe(
      'chat.channel.role_too_high',
    );
  } finally {
    await bystander.dispose();
    await chanAdmin.dispose();
    await admin.dispose();
  }
});

test('chat realtime: a sent message reaches a subscribed channel socket', async () => {
  const admin = await request.newContext({ storageState: STORAGE_STATE, baseURL: API });
  const h = await headers(admin);
  const cookie = cookieFor(await admin.storageState());

  // Create the channel first — then open the sockets and immediately await `connection.ready`, so the
  // `once` listener is attached before the handshake completes.
  const channel = await j<{ id: string }>(
    await admin.post('/api/v1/chat/channels', {
      headers: h,
      data: { kind: 'private', name: `RT ${Date.now()}` },
    }),
  );

  const opts = { extraHeaders: { cookie }, transports: ['websocket'], forceNew: true };
  const a = io(WS, opts);
  const b = io(WS, opts);
  try {
    await Promise.all([
      nextEvent(a, 'connection.ready', 4000),
      nextEvent(b, 'connection.ready', 4000),
    ]);
    const [ackA, ackB] = await Promise.all([
      subscribeChannel(a, channel.id),
      subscribeChannel(b, channel.id),
    ]);
    expect(ackA.ok && ackB.ok, 'both clients join the channel room').toBe(true);

    const got = nextEvent<{ channelId: string; messageId: string }>(
      b,
      'chat.message.created',
      3000,
    );
    const t0 = Date.now();
    const sent = await j<{ id: string }>(
      await admin.post(`/api/v1/chat/channels/${channel.id}/messages`, {
        headers: h,
        data: { kind: 'text', body: doc('live') },
      }),
    );
    const payload = await got;
    console.log(`chat realtime latency: ${Date.now() - t0}ms`);
    expect(payload.channelId).toBe(channel.id);
    expect(payload.messageId).toBe(sent.id);
  } finally {
    a.disconnect();
    b.disconnect();
    await admin.dispose();
  }
});
