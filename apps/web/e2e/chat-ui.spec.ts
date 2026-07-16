import { expect, request, test, type APIRequestContext } from '@playwright/test';
import { csrfHeaders } from './support/api';
import { STORAGE_STATE } from './support/fixtures';

/**
 * Chat screen smoke (docs/modules/13 §7, task 5.3). Drives the real 3-column chat UI as the enrolled
 * superadmin: open a seeded channel, see its history, and send a message through the TipTap composer.
 */
const API = 'http://localhost:3000';

const doc = (text: string) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});

async function j<T>(res: { json: () => Promise<unknown> }): Promise<T> {
  return (await res.json()) as T;
}

test('chat UI: opens a channel, shows history and sends a message', async ({ page }) => {
  const admin: APIRequestContext = await request.newContext({
    storageState: STORAGE_STATE,
    baseURL: API,
  });
  const h = { ...(await csrfHeaders(admin)), 'content-type': 'application/json' };
  const name = `UI канал ${Date.now()}`;
  const channel = await j<{ id: string }>(
    await admin.post('/api/v1/chat/channels', {
      headers: h,
      data: { kind: 'private', name },
    }),
  );
  await admin.post(`/api/v1/chat/channels/${channel.id}/messages`, {
    headers: h,
    data: { kind: 'text', body: doc('Первое сообщение') },
  });
  await admin.dispose();

  // The empty landing state renders when no channel is selected.
  await page.goto('/app/chat');
  await expect(page.getByText('Выберите беседу')).toBeVisible();

  // Open the seeded channel: header + existing history are shown.
  await page.goto(`/app/chat/${channel.id}`);
  await expect(page.getByRole('heading', { name })).toBeVisible();
  await expect(page.getByText('Первое сообщение')).toBeVisible();

  // Send a message through the composer (TipTap contenteditable, Enter to send).
  const composer = page.getByRole('textbox', { name: 'Написать сообщение…' });
  await composer.click();
  await page.keyboard.type('Привет из UI');
  const sent = page.waitForResponse(
    (r) =>
      r.url().includes(`/chat/channels/${channel.id}/messages`) && r.request().method() === 'POST',
  );
  await page.keyboard.press('Enter');
  await sent;
  await expect(page.getByText('Привет из UI')).toBeVisible();
});
