import { expect, request, test, type APIRequestContext } from '@playwright/test';
import { io, type Socket } from 'socket.io-client';
import { apiLogin, csrfHeaders } from './support/api';
import { E2E_USER, STORAGE_STATE } from './support/fixtures';

/**
 * Task 5.7 e2e (docs/modules/13 §6): a mention notifies an offline / not-in-channel member in-app,
 * a muted channel suppresses it, and a member actively viewing the channel is not notified.
 */
const API = 'http://localhost:3000';
const WS = `${API}/ws`;

const mentionDoc = (userId: string, label: string) => ({
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        { type: 'mention', attrs: { id: userId, label } },
        { type: 'text', text: ' срочно' },
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
async function mention(
  admin: APIRequestContext,
  channelId: string,
  userId: string,
): Promise<string> {
  const h = await headers(admin);
  const m = await j<{ id: string }>(
    await admin.post(`/api/v1/chat/channels/${channelId}/messages`, {
      headers: h,
      data: { kind: 'text', body: mentionDoc(userId, 'Коллега') },
    }),
  );
  return m.id;
}
async function notificationFor(ctx: APIRequestContext, messageId: string): Promise<boolean> {
  const res = await j<{
    items: { type: string; entityType: string | null; payload: Record<string, unknown> }[];
  }>(await ctx.get('/api/v1/notifications?limit=50'));
  return res.items.some(
    (n) => n.entityType === 'chat_channel' && n.payload['messageId'] === messageId,
  );
}

test('a mention notifies an offline member in-app, and mute suppresses it', async () => {
  const admin = await request.newContext({ storageState: STORAGE_STATE, baseURL: API });
  const h = await headers(admin);
  const member = await apiLogin(E2E_USER.username, E2E_USER.password);
  const memberMe = await j<{ id: string }>(await member.get('/api/auth/me'));
  try {
    const channel = await j<{ id: string }>(
      await admin.post('/api/v1/chat/channels', {
        headers: h,
        data: { kind: 'private', name: `Notify ${Date.now()}` },
      }),
    );
    await admin.post(`/api/v1/chat/channels/${channel.id}/members`, {
      headers: h,
      data: { userId: memberMe.id, role: 'member' },
    });

    // The member is offline (HTTP only, no socket) — the mention arrives as an in-app notification.
    const first = await mention(admin, channel.id, memberMe.id);
    await expect.poll(() => notificationFor(member, first), { timeout: 5000 }).toBe(true);

    // Muting the channel suppresses the next mention.
    await member.patch(`/api/v1/chat/channels/${channel.id}/membership`, {
      headers: await headers(member),
      data: { notifyLevel: 'mute' },
    });
    const second = await mention(admin, channel.id, memberMe.id);
    // Give the fire-and-forget fan-out time to (not) create anything.
    await new Promise((r) => setTimeout(r, 1500));
    expect(await notificationFor(member, second)).toBe(false);
  } finally {
    await member.dispose();
    await admin.dispose();
  }
});

test('a member actively viewing the channel is not notified', async () => {
  const admin = await request.newContext({ storageState: STORAGE_STATE, baseURL: API });
  const h = await headers(admin);
  const member = await apiLogin(E2E_USER.username, E2E_USER.password);
  const memberMe = await j<{ id: string }>(await member.get('/api/auth/me'));
  const session = (await member.storageState()).cookies.find((c) => c.name === 'cuks_session');

  // Set up the channel + membership first, THEN open the socket and immediately await ready, so the
  // `once('connection.ready')` listener is attached before the handshake completes.
  const channel = await j<{ id: string }>(
    await admin.post('/api/v1/chat/channels', {
      headers: h,
      data: { kind: 'private', name: `Viewing ${Date.now()}` },
    }),
  );
  await admin.post(`/api/v1/chat/channels/${channel.id}/members`, {
    headers: h,
    data: { userId: memberMe.id, role: 'member' },
  });

  const sock: Socket = io(WS, {
    extraHeaders: { cookie: `cuks_session=${session!.value}` },
    transports: ['websocket'],
    forceNew: true,
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('ready timeout')), 4000);
      sock.once('connection.ready', () => {
        clearTimeout(timer);
        resolve();
      });
    });
    // The member joins the channel room (i.e. is viewing it).
    const ack = await new Promise<{ ok: boolean }>((resolve) => {
      sock.emit('channel.subscribe', { channelId: channel.id }, (a: { ok: boolean }) => resolve(a));
    });
    expect(ack.ok).toBe(true);

    const msg = await mention(admin, channel.id, memberMe.id);
    await new Promise((r) => setTimeout(r, 1500));
    expect(await notificationFor(member, msg)).toBe(false);
  } finally {
    sock.disconnect();
    await member.dispose();
    await admin.dispose();
  }
});
