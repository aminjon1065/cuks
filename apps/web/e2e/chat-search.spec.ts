import { expect, request, test, type APIRequestContext } from '@playwright/test';
import { apiLogin, csrfHeaders } from './support/api';
import { E2E_USER, STORAGE_STATE } from './support/fixtures';

/**
 * Task 5.6 e2e (docs/modules/13 §4/§8): message search (scoping + filters), jump-to-message window,
 * and the incident channel — plus a search→jump UI smoke.
 */
const API = 'http://localhost:3000';
const TERM = 'зурбаган'; // a distinctive token, unlikely elsewhere in the seed

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
async function post(ctx: APIRequestContext, channelId: string, text: string): Promise<string> {
  const h = await headers(ctx);
  const m = await j<{ id: string }>(
    await ctx.post(`/api/v1/chat/channels/${channelId}/messages`, {
      headers: h,
      data: { kind: 'text', body: doc(text) },
    }),
  );
  return m.id;
}

test('search is scoped to my channels and honours the channel/author filters', async () => {
  const admin = await request.newContext({ storageState: STORAGE_STATE, baseURL: API });
  const h = await headers(admin);
  const me = await j<{ id: string }>(await admin.get('/api/auth/me'));
  const channel = await j<{ id: string }>(
    await admin.post('/api/v1/chat/channels', {
      headers: h,
      data: { kind: 'private', name: `Поиск ${Date.now()}` },
    }),
  );
  await post(admin, channel.id, `секретный ${TERM} в канале`);
  const outsider = await apiLogin(E2E_USER.username, E2E_USER.password);
  try {
    // The author finds the hit.
    const mine = await j<{ items: { messageId: string; channelId: string }[] }>(
      await admin.get(`/api/v1/chat/search?q=${TERM}`),
    );
    expect(mine.items.some((r) => r.channelId === channel.id)).toBe(true);

    // A non-member never sees a private channel's messages in search.
    const theirs = await j<{ items: unknown[] }>(
      await outsider.get(`/api/v1/chat/search?q=${TERM}`),
    );
    expect(theirs.items).toHaveLength(0);

    // Channel filter to a channel the caller can't read is rejected, not silently empty.
    const forbidden = await outsider.get(`/api/v1/chat/search?q=${TERM}&channelId=${channel.id}`);
    expect(forbidden.status()).toBe(403);

    // Author filter: my own id matches, a different id doesn't.
    const byMe = await j<{ items: unknown[] }>(
      await admin.get(`/api/v1/chat/search?q=${TERM}&fromUserId=${me.id}`),
    );
    expect(byMe.items.length).toBeGreaterThanOrEqual(1);
    const outsiderMe = await j<{ id: string }>(await outsider.get('/api/auth/me'));
    const byOther = await j<{ items: unknown[] }>(
      await admin.get(`/api/v1/chat/search?q=${TERM}&fromUserId=${outsiderMe.id}`),
    );
    expect(byOther.items).toHaveLength(0);
  } finally {
    await outsider.dispose();
    await admin.dispose();
  }
});

test('jump-to-message returns a window centered on the target', async () => {
  const admin = await request.newContext({ storageState: STORAGE_STATE, baseURL: API });
  const h = await headers(admin);
  const channel = await j<{ id: string }>(
    await admin.post('/api/v1/chat/channels', {
      headers: h,
      data: { kind: 'private', name: `Окно ${Date.now()}` },
    }),
  );
  const ids: string[] = [];
  for (let i = 0; i < 8; i++) ids.push(await post(admin, channel.id, `сообщение ${i}`));
  const target = ids[2]!;
  try {
    const window = await j<{ items: { id: string }[] }>(
      await admin.get(`/api/v1/chat/channels/${channel.id}/messages?around=${target}&limit=6`),
    );
    const windowIds = window.items.map((m) => m.id);
    expect(windowIds).toContain(target);
    // The window carries both newer and older neighbours of the target.
    expect(windowIds).toContain(ids[3]);
    expect(windowIds).toContain(ids[1]);
  } finally {
    await admin.dispose();
  }
});

test('an incident channel is created idempotently and linked back', async () => {
  const admin = await request.newContext({ storageState: STORAGE_STATE, baseURL: API });
  const h = await headers(admin);
  try {
    const incidents = await j<{ items: { id: string; number: string }[] }>(
      await admin.get('/api/v1/incidents?limit=1'),
    );
    const incident = incidents.items[0];
    expect(incident, 'the e2e seed has at least one incident').toBeTruthy();

    const channel = await j<{
      id: string;
      name: string;
      kind: string;
      myRole: string;
      linkedIncident: { id: string; number: string } | null;
    }>(
      await admin.post('/api/v1/chat/channels/from-incident', {
        headers: h,
        data: { incidentId: incident!.id },
      }),
    );
    expect(channel.kind).toBe('incident');
    expect(channel.name).toBe(`чс-${incident!.number}`);
    expect(channel.myRole).toBe('owner');
    expect(channel.linkedIncident?.id).toBe(incident!.id);

    // Idempotent — opening it again returns the same channel.
    const again = await j<{ id: string }>(
      await admin.post('/api/v1/chat/channels/from-incident', {
        headers: h,
        data: { incidentId: incident!.id },
      }),
    );
    expect(again.id).toBe(channel.id);

    // A chat user without incidents.manage cannot self-join an incident channel.
    const employee = await apiLogin(E2E_USER.username, E2E_USER.password);
    try {
      const eh = await headers(employee);
      const refused = await employee.post('/api/v1/chat/channels/from-incident', {
        headers: eh,
        data: { incidentId: incident!.id },
      });
      expect(refused.status()).toBe(403);
    } finally {
      await employee.dispose();
    }
  } finally {
    await admin.dispose();
  }
});

test('chat UI: search a message and jump to it', async ({ page }) => {
  const admin = await request.newContext({ storageState: STORAGE_STATE, baseURL: API });
  const h = await headers(admin);
  const channel = await j<{ id: string }>(
    await admin.post('/api/v1/chat/channels', {
      headers: h,
      data: { kind: 'private', name: `Поиск UI ${Date.now()}` },
    }),
  );
  // Bury the target under later messages so it isn't already on screen.
  await post(admin, channel.id, `найди меня ${TERM} здесь`);
  for (let i = 0; i < 5; i++) await post(admin, channel.id, `прочие сообщения ${i}`);
  await admin.dispose();

  await page.goto(`/app/chat/${channel.id}`);
  await page.getByRole('button', { name: 'Поиск сообщений' }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByPlaceholder('Искать в переписке…').fill(TERM);
  // Results are newest-first, so the first hit is this run's message (matches persist across runs).
  const result = dialog.locator('button', { hasText: 'найди меня' }).first();
  await expect(result).toBeVisible();
  await result.click();
  // The fragment view opens with the target and its "back to latest" affordance.
  await expect(page).toHaveURL(/\?msg=/);
  await expect(page.getByText('Показан фрагмент переписки')).toBeVisible();
  await expect(page.getByText(/найди меня/).first()).toBeVisible();
});
