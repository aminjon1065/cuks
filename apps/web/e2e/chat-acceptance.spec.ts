import { expect, request, test, type APIRequestContext } from '@playwright/test';
import { csrfHeaders } from './support/api';
import { STORAGE_STATE } from './support/fixtures';

/**
 * Task 5.8 — module §10 acceptance beyond the per-feature specs: reconnect without duplicates (the
 * feed refetches the last page + unread on reconnect and never doubles a message), and org-unit
 * channel membership syncing when a staff member is assigned to / removed from a unit position.
 * (Delivery <300ms, closed-channel REST+WS rights, jump-to-message and mention notifications are
 * covered by chat.spec.ts / chat-search.spec.ts / chat-notify.spec.ts.)
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

test('reconnect refetches missed messages without duplicating them', async ({ page }) => {
  const admin = await request.newContext({ storageState: STORAGE_STATE, baseURL: API });
  const h = await headers(admin);
  const channel = await j<{ id: string }>(
    await admin.post('/api/v1/chat/channels', {
      headers: h,
      data: { kind: 'private', name: `Reconnect ${Date.now()}` },
    }),
  );
  try {
    await page.goto(`/app/chat/${channel.id}`);
    // Wait for the socket to be authorized (dev handle set by SocketProvider).
    await page.waitForFunction(() => window.__cuksSocketReady === true, {
      timeout: 10_000,
    });

    // Send one message through the composer — it must appear exactly once (optimistic → reconciled,
    // and the echoed realtime event must not add a second copy).
    const composer = page.getByRole('textbox', { name: 'Написать сообщение…' });
    await composer.click();
    await page.keyboard.type('до реконнекта');
    await page.keyboard.press('Enter');
    await expect(page.getByText('до реконнекта')).toHaveCount(1);

    // Drop the socket, post a message from the server side while offline, then reconnect.
    await page.evaluate(() => window.__cuksSocket?.disconnect());
    await page.waitForFunction(() => window.__cuksSocket?.connected === false, {
      timeout: 5_000,
    });
    await admin.post(`/api/v1/chat/channels/${channel.id}/messages`, {
      headers: h,
      data: { kind: 'text', body: doc('пока был офлайн') },
    });
    await page.evaluate(() => window.__cuksSocket?.connect());
    await page.waitForFunction(() => window.__cuksSocketReady === true, {
      timeout: 10_000,
    });

    // The missed message shows up via the reconnect refetch, and neither message is duplicated.
    await expect(page.getByText('пока был офлайн')).toHaveCount(1);
    await expect(page.getByText('до реконнекта')).toHaveCount(1);
  } finally {
    await admin.dispose();
  }
});

test('assigning a staff member to a unit position adds them to the org channel', async () => {
  const admin = await request.newContext({ storageState: STORAGE_STATE, baseURL: API });
  const h = await headers(admin);
  const me = await j<{ id: string }>(await admin.get('/api/auth/me'));
  try {
    // A fresh org unit auto-provisions its org channel (ensureChannel).
    const unit = await j<{ id: string }>(
      await admin.post('/api/v1/admin/org-units', {
        headers: h,
        data: { name: `Отдел синхронизации ${Date.now()}`, type: 'department' },
      }),
    );
    const position = await j<{ id: string }>(
      await admin.post('/api/v1/admin/positions', {
        headers: h,
        data: { orgUnitId: unit.id, name: 'Специалист' },
      }),
    );

    // My membership of the org channel is observable through my conversation list.
    const inOrgChannel = async (): Promise<boolean> => {
      const mine = await j<{ kind: string; orgUnitId: string | null }[]>(
        await admin.get('/api/v1/chat/channels'),
      );
      return mine.some((c) => c.kind === 'org' && c.orgUnitId === unit.id);
    };

    // Assign the admin to the position → the org-channel sync should add them (fire-and-forget).
    const assignment = await j<{ id: string }>(
      await admin.post('/api/v1/admin/user-positions', {
        headers: h,
        data: { userId: me.id, positionId: position.id },
      }),
    );
    await expect.poll(inOrgChannel, { timeout: 8000 }).toBe(true);

    // Removing the assignment syncs them back out of the channel.
    await admin.delete(`/api/v1/admin/user-positions/${assignment.id}`, {
      headers: await csrfHeaders(admin),
    });
    await expect.poll(inOrgChannel, { timeout: 8000 }).toBe(false);
  } finally {
    await admin.dispose();
  }
});
