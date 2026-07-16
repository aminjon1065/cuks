import { expect, request, test, type APIRequestContext } from '@playwright/test';
import { apiLogin, csrfHeaders } from './support/api';
import { E2E_USER, STORAGE_STATE } from './support/fixtures';

/**
 * Task 5.5 e2e (docs/modules/13 §4): replies, reactions, edit/delete and pins — the REST semantics
 * (authz + windows) plus a UI smoke of the reaction chip and reply quote.
 */
const API = 'http://localhost:3000';

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
async function csrf(ctx: APIRequestContext): Promise<Record<string, string>> {
  return csrfHeaders(ctx);
}

async function seedChannel(admin: APIRequestContext, name: string) {
  const h = await headers(admin);
  const channel = await j<{ id: string }>(
    await admin.post('/api/v1/chat/channels', { headers: h, data: { kind: 'private', name } }),
  );
  const member = await apiLogin(E2E_USER.username, E2E_USER.password);
  const memberMe = await j<{ id: string }>(await member.get('/api/auth/me'));
  await admin.post(`/api/v1/chat/channels/${channel.id}/members`, {
    headers: h,
    data: { userId: memberMe.id, role: 'member' },
  });
  return { channel, member, h };
}

async function postMessage(
  ctx: APIRequestContext,
  channelId: string,
  text: string,
): Promise<string> {
  const h = await headers(ctx);
  const m = await j<{ id: string }>(
    await ctx.post(`/api/v1/chat/channels/${channelId}/messages`, {
      headers: h,
      data: { kind: 'text', body: doc(text) },
    }),
  );
  return m.id;
}

test('reactions toggle, replies quote, edit marks and delete tombstones', async () => {
  const admin = await request.newContext({ storageState: STORAGE_STATE, baseURL: API });
  const { channel, member } = await seedChannel(admin, `Actions ${Date.now()}`);
  const mh = await headers(member);
  try {
    const original = await postMessage(admin, channel.id, 'исходное сообщение');

    // Reaction toggles on/off, palette-restricted.
    const bad = await member.put(`/api/v1/chat/messages/${original}/reactions`, {
      headers: mh,
      data: { emoji: 'not-an-emoji' },
    });
    expect(bad.status()).toBe(400);
    await member.put(`/api/v1/chat/messages/${original}/reactions`, {
      headers: mh,
      data: { emoji: '👍' },
    });
    let page = await j<{ items: { id: string; reactions: { emoji: string; count: number }[] }[] }>(
      await admin.get(`/api/v1/chat/channels/${channel.id}/messages`),
    );
    const msg = page.items.find((m) => m.id === original)!;
    expect(msg.reactions).toEqual([{ emoji: '👍', count: 1, mine: false }]);
    await member.put(`/api/v1/chat/messages/${original}/reactions`, {
      headers: mh,
      data: { emoji: '👍' },
    });
    page = await j(await admin.get(`/api/v1/chat/channels/${channel.id}/messages`));
    expect(page.items.find((m) => m.id === original)!.reactions).toEqual([]);

    // Reply carries a denormalized snippet.
    const reply = await j<{ id: string; replyTo: { id: string; bodyText: string } | null }>(
      await member.post(`/api/v1/chat/channels/${channel.id}/messages`, {
        headers: mh,
        data: { kind: 'text', body: doc('вот ответ'), replyToId: original },
      }),
    );
    expect(reply.replyTo?.id).toBe(original);
    expect(reply.replyTo?.bodyText).toBe('исходное сообщение');

    // Edit stamps editedAt and updates the text.
    const edited = await j<{ editedAt: string | null; bodyText: string }>(
      await member.patch(`/api/v1/chat/messages/${reply.id}`, {
        headers: mh,
        data: { body: doc('исправленный ответ') },
      }),
    );
    expect(edited.editedAt).toBeTruthy();
    expect(edited.bodyText).toBe('исправленный ответ');

    // A non-author non-admin cannot edit or delete someone else's message.
    const forbiddenEdit = await member.patch(`/api/v1/chat/messages/${original}`, {
      headers: mh,
      data: { body: doc('взлом') },
    });
    expect(forbiddenEdit.status()).toBe(403);

    // The channel admin can delete anyone's message → tombstone (body nulled).
    const del = await admin.delete(`/api/v1/chat/messages/${reply.id}`, {
      headers: await csrf(admin),
    });
    expect(del.ok()).toBeTruthy();
    const full = await j<{ items: { id: string; deletedAt: string | null; body: unknown }[] }>(
      await admin.get(`/api/v1/chat/channels/${channel.id}/messages`),
    );
    const tomb = full.items.find((m) => m.id === reply.id)!;
    expect(tomb.deletedAt).toBeTruthy();
    expect(tomb.body).toBeNull();
  } finally {
    await member.dispose();
    await admin.dispose();
  }
});

test('pins are admin-only and listed in the panel', async () => {
  const admin = await request.newContext({ storageState: STORAGE_STATE, baseURL: API });
  const { channel, member, h } = await seedChannel(admin, `Pins ${Date.now()}`);
  const mh = await headers(member);
  try {
    const target = await postMessage(admin, channel.id, 'важное объявление');

    // A plain member cannot pin.
    const memberPin = await member.post(`/api/v1/chat/channels/${channel.id}/pins`, {
      headers: mh,
      data: { messageId: target },
    });
    expect(memberPin.status()).toBe(403);

    // The admin pins it, and it appears in the list.
    await admin.post(`/api/v1/chat/channels/${channel.id}/pins`, {
      headers: h,
      data: { messageId: target },
    });
    const pins = await j<{ messageId: string; bodyText: string }[]>(
      await admin.get(`/api/v1/chat/channels/${channel.id}/pins`),
    );
    expect(pins.map((p) => p.messageId)).toContain(target);

    await admin.delete(`/api/v1/chat/channels/${channel.id}/pins/${target}`, {
      headers: await csrf(admin),
    });
    const after = await j<{ messageId: string }[]>(
      await admin.get(`/api/v1/chat/channels/${channel.id}/pins`),
    );
    expect(after.map((p) => p.messageId)).not.toContain(target);
  } finally {
    await member.dispose();
    await admin.dispose();
  }
});

test('chat UI: react to a message and see the chip', async ({ page }) => {
  const admin = await request.newContext({ storageState: STORAGE_STATE, baseURL: API });
  const h = await headers(admin);
  const name = `React UI ${Date.now()}`;
  const channel = await j<{ id: string }>(
    await admin.post('/api/v1/chat/channels', { headers: h, data: { kind: 'private', name } }),
  );
  await postMessage(admin, channel.id, 'наведи и поставь реакцию');
  await admin.dispose();

  await page.goto(`/app/chat/${channel.id}`);
  const message = page.getByText('наведи и поставь реакцию');
  await expect(message).toBeVisible();
  await message.hover();
  await page.getByRole('button', { name: 'Реакция' }).first().click();
  const reacted = page.waitForResponse(
    (r) => r.url().includes('/reactions') && r.request().method() === 'PUT',
  );
  await page.getByRole('button', { name: '🔥' }).click();
  await reacted;
  // The reaction chip shows the emoji with a count.
  await expect(page.getByRole('button', { name: /🔥\s*1/ })).toBeVisible();
});
