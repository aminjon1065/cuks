import { expect, test } from '@playwright/test';

/**
 * Document cabinet + card UI smoke (docs/modules/11 §7, task 3.2). Drives the real
 * screens as the enrolled superadmin (authed project): open the cabinet, create a
 * document, then register it from the card — asserting a journal number is minted
 * and the status advances. Exercises the pages end-to-end against the API + DB.
 */
test('docflow UI: create a document and register it from the card', async ({ page }) => {
  await page.goto('/app/docs');
  await expect(page.getByRole('main').getByRole('heading', { name: 'Кабинет ДОУ' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Мои документы' })).toBeVisible();

  // Create a document via the dialog.
  await page.getByRole('button', { name: 'Создать документ' }).first().click();
  const dialog = page.getByRole('dialog');
  const subject = `UI приказ ${Date.now()}`;
  await dialog.getByLabel('Тема').fill(subject);
  const created = page.waitForResponse(
    (r) =>
      r.url().endsWith('/docflow/documents') &&
      r.request().method() === 'POST' &&
      r.status() === 201,
  );
  await dialog.getByRole('button', { name: 'Создать' }).click();
  await created;

  // The card opens on the freshly created draft.
  await expect(page.getByRole('main').getByRole('heading', { name: subject })).toBeVisible();
  await expect(page.getByTestId('document-status')).toContainText('Черновик');

  // Register it: the card mints a journal number and flips to «Зарегистрирован».
  await page.getByRole('button', { name: 'Зарегистрировать' }).first().click();
  const regDialog = page.getByRole('dialog');
  const submit = regDialog.getByRole('button', { name: 'Зарегистрировать' });
  // The submit is disabled until the journal list loads — wait for it, then register.
  await expect(submit).toBeEnabled();
  await submit.click();

  // The card refetches: the status flips and a journal number appears in the title.
  await expect(page.getByTestId('document-status')).toContainText('Зарегистрирован', {
    timeout: 15_000,
  });
  await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toContainText(
    /\S+-\d{4}\/\d{4}/,
  );
});
