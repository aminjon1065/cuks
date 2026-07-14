import { expect, test } from '@playwright/test';

/**
 * QGIS/ArcGIS integration UI (docs/modules/10 §7, task 2.9): the «Для
 * ГИС-специалистов» connection page and the admin «Доступ ГИС» account manager.
 * Runs in the `authed` project (the seeded e2e superadmin holds gis.pg.access).
 */

test('gis access: connection details page shows PostGIS + OGC endpoints', async ({ page }) => {
  await page.goto('/app/map/gis-access');
  await expect(page.getByRole('heading', { name: 'Для ГИС-специалистов' })).toBeVisible();

  // The direct PostGIS coordinates are always shown.
  await expect(page.getByTestId('pg-host')).toBeVisible();
  await expect(page.getByTestId('pg-port')).toBeVisible();
  // The schema is always gis (the only one the accounts can see).
  await expect(page.getByText('gis', { exact: true }).first()).toBeVisible();
});

test('gis access: an admin issues and revokes a PostGIS account, password shown once', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.goto('/app/admin/gis-access');
  // The title shows in both the topbar and the page header (the nav label resolves to
  // «Доступ ГИС» too), so scope to the main region to keep the locator unambiguous.
  await expect(page.getByRole('main').getByRole('heading', { name: 'Доступ ГИС' })).toBeVisible();

  // Create a reader account.
  await page.getByTestId('create-db-account').click();
  await page.getByLabel('Метка').fill(`e2e ${Date.now()}`);
  await page.getByLabel('Тип доступа').selectOption('reader');
  const created = page.waitForResponse(
    (r) =>
      r.url().includes('/api/v1/admin/gis/db-accounts') &&
      r.request().method() === 'POST' &&
      r.status() === 201,
  );
  await page.getByRole('button', { name: 'Создать учётную запись' }).click();
  const username = ((await (await created).json()) as { username: string }).username;
  expect(username).toMatch(/^cuks_gis_/);

  // The password is revealed once, in the secret dialog.
  const secret = page.getByTestId('db-account-secret');
  await expect(secret).toBeVisible();
  await expect(page.getByTestId('secret-username')).toHaveText(username);
  await expect(page.getByTestId('secret-password')).not.toBeEmpty();
  await page.getByRole('button', { name: 'Готово' }).click();

  // It appears in the list (without the password).
  await expect(page.getByTestId('db-account-list').getByText(username)).toBeVisible();

  // Revoke it.
  const removed = page.waitForResponse(
    (r) => r.url().includes('/api/v1/admin/gis/db-accounts/') && r.request().method() === 'DELETE',
  );
  await page.getByRole('button', { name: `Отозвать «${username}»` }).click();
  await page.getByRole('button', { name: 'Отозвать', exact: true }).click();
  await removed;
  await expect(page.getByTestId('db-account-list').getByText(username)).toHaveCount(0);
});
