import { expect, test } from '@playwright/test';

/**
 * Call-room UI smoke (docs/modules/14 §3, task 6.3). Drives the real meet UI as the enrolled
 * superadmin: the landing starts a new meeting, navigates to the room, and shows the pre-join screen.
 * (A full LiveKit media session needs real devices + the SFU and is covered by the manual/e2e run in
 * task 6.7 — the occluded preview pane can't render WebRTC media.)
 */
test('meet UI: landing starts a new meeting and shows the pre-join screen', async ({ page }) => {
  // Pre-grant media so the pre-join device preview doesn't block on a permission prompt.
  await page
    .context()
    .grantPermissions(['camera', 'microphone'])
    .catch(() => {});

  await page.goto('/app/meet');
  await expect(page.getByRole('button', { name: 'Новая встреча' })).toBeVisible();
  await expect(page.getByPlaceholder('Вставьте ссылку или код комнаты')).toBeVisible();

  await page.getByRole('button', { name: 'Новая встреча' }).click();
  await page.waitForURL(/\/app\/meet\/r\/[0-9a-f]{16}/, { timeout: 15_000 });

  // The room loads and the pre-join screen appears (its own heading renders regardless of media).
  await expect(page.getByText('Готовы присоединиться?')).toBeVisible({ timeout: 15_000 });
});
