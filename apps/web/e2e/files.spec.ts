import { expect, test } from '@playwright/test';

// Runs in the `authed` project (admin session from global-setup). Smoke-tests the
// Files screen (docs/modules/12 §6): sections render, and creating a folder shows
// it in the listing.
test('files screen: sections render and a new folder appears', async ({ page }) => {
  await page.goto('/app/files');

  // Sections rail + toolbar are present.
  await expect(page.getByRole('button', { name: 'Мои файлы' })).toBeVisible();
  await expect(page.getByTestId('files-upload')).toBeVisible();

  // Create a uniquely-named folder so repeated runs never collide.
  const name = `Папка ${Date.now()}`;
  await page.getByTestId('files-new-folder').click();
  await page.locator('#folder-name').fill(name);
  await page.locator('[role="dialog"] button[type="submit"]').click();

  // It shows up in the current folder listing.
  await expect(page.getByText(name)).toBeVisible();
});

test('files screen: shared and trash sections open with their empty states', async ({ page }) => {
  await page.goto('/app/files');

  await page.getByRole('button', { name: 'Доступные мне' }).click();
  await expect(page).toHaveURL(/section=shared/);

  await page.getByRole('button', { name: 'Корзина' }).click();
  await expect(page).toHaveURL(/section=trash/);
});
