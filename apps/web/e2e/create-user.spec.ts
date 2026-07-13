import { expect, test } from '@playwright/test';

// Runs in the `authed` project (admin session from global-setup).
test('creates a user and reveals a one-time password', async ({ page }) => {
  await page.goto('/app/admin/users');
  await page.getByTestId('users-create').click();

  // Timestamp in the first name-word → the generated username (first two words) is
  // globally unique, so it can't collide with users accumulated from earlier runs.
  await page.locator('#fullName').fill(`Тест${Date.now()} Пользователь`);
  await page.locator('[role="dialog"] button[type="submit"]').click();

  // Success replaces the form with the one-time credential reveal.
  await expect(page.getByTestId('temp-username')).toBeVisible();
  await expect(page.getByTestId('temp-username')).not.toBeEmpty();
  await expect(page.getByTestId('temp-password')).not.toBeEmpty();
});
