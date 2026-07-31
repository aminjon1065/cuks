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

/**
 * The resolution-type dictionary (docs/modules/11 §12.11, plan этап 5): the seeded types
 * are listed, and a type can be added and removed again. Deletion is only offered for a
 * type no proposal points at — a used one refuses with `docflow.resolution_type.in_use`,
 * which the panel explains rather than surfacing a foreign-key error.
 */
test('docflow settings: manage the resolution-type dictionary', async ({ page }) => {
  await page.goto('/app/docs/settings');
  await page.getByRole('tab', { name: 'Типы резолюций' }).click();

  await expect(page.getByRole('cell', { name: 'Исполнить' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Ознакомить' })).toBeVisible();

  const code = `e2e_${Date.now()}`;
  await page.getByRole('button', { name: 'Добавить тип' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Код').fill(code);
  await dialog.getByLabel('Название (рус.)').fill('E2E тип');
  await dialog.getByLabel('Название (тадж.)').fill('E2E навъ');
  await dialog.getByLabel('срок', { exact: true }).check();

  const created = page.waitForResponse(
    (r) =>
      r.url().includes('/docflow/resolution-types') &&
      r.request().method() === 'POST' &&
      r.status() === 201,
  );
  await dialog.getByRole('button', { name: 'Сохранить' }).click();
  await created;
  await expect(page.getByRole('cell', { name: code })).toBeVisible();

  const row = page.getByRole('row', { name: new RegExp(code) });
  await row.getByRole('button', { name: 'Удалить' }).click();
  const deleted = page.waitForResponse(
    (r) =>
      /\/docflow\/resolution-types\/[0-9a-f-]+$/.test(r.url()) &&
      r.request().method() === 'DELETE' &&
      r.status() === 204,
  );
  await page.getByRole('dialog').getByRole('button', { name: 'Удалить' }).click();
  await deleted;
  await expect(page.getByRole('cell', { name: code })).toBeHidden();
});
