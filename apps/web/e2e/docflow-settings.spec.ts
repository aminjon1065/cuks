import { expect, test } from '@playwright/test';

/**
 * «Настройки ДОУ» reference-data screen (docs/modules/11 §1/§7, task 3.1). Smoke:
 * the seeded journals load, and a journal can be created and deleted end-to-end
 * (exercising the docflow reference CRUD API + PostgreSQL). Runs in the `authed`
 * project (the seeded superadmin holds `docflow.journals.manage` via wildcard).
 */
test('docflow settings: create and delete a registration journal', async ({ page }) => {
  await page.goto('/app/docs/settings');
  await expect(
    page.getByRole('main').getByRole('heading', { name: 'Настройки ДОУ' }),
  ).toBeVisible();

  // The standard seeded journals are listed.
  await expect(page.getByText('Входящие документы')).toBeVisible();

  const code = `e2e-${Date.now()}`;
  await page.getByRole('button', { name: 'Добавить журнал' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Код').fill(code);
  await dialog.getByLabel('Название').fill('E2E журнал');

  const created = page.waitForResponse(
    (r) =>
      r.url().includes('/docflow/journals') &&
      r.request().method() === 'POST' &&
      r.status() === 201,
  );
  await dialog.getByRole('button', { name: 'Сохранить' }).click();
  await created;
  await expect(page.getByRole('cell', { name: code })).toBeVisible();

  // Delete it again — exercises the confirm dialog and the DELETE endpoint, and
  // keeps reruns clean (the code is unique per run anyway).
  const row = page.getByRole('row', { name: new RegExp(code) });
  await row.getByRole('button', { name: 'Удалить' }).click();
  const deleted = page.waitForResponse(
    (r) =>
      /\/docflow\/journals\/[0-9a-f-]+$/.test(r.url()) &&
      r.request().method() === 'DELETE' &&
      r.status() === 200,
  );
  await page.getByRole('dialog').getByRole('button', { name: 'Удалить' }).click();
  await deleted;
  await expect(page.getByRole('cell', { name: code })).toBeHidden();
});
