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

test('files screen: uploading a text file and opening it in the viewer overlay', async ({
  page,
}) => {
  await page.goto('/app/files');

  // Upload a small text file straight through the hidden input (exercises the
  // real presigned-multipart flow: initiate → XHR PUT to MinIO → complete).
  const name = `viewer-smoke-${Date.now()}.txt`;
  const content = `CUKS viewer smoke ${Date.now()}`;
  // Target the toolbar input by testid: an empty folder also renders the
  // FileDropzone (which has its own file input), so `input[type=file]` is ambiguous.
  await page.getByTestId('files-file-input').setInputFiles({
    name,
    mimeType: 'text/plain',
    buffer: Buffer.from(content),
  });

  const cell = page.locator('table').getByText(name);
  await expect(cell).toBeVisible({ timeout: 20_000 });

  // Double-click opens the full-screen quick-view overlay with the text content.
  await cell.dblclick();
  const overlay = page.locator('[role="dialog"][aria-modal="true"]');
  await expect(overlay).toBeVisible();
  await expect(overlay.getByText(content)).toBeVisible({ timeout: 10_000 });

  // Esc closes it.
  await page.keyboard.press('Escape');
  await expect(overlay).toBeHidden();
});
