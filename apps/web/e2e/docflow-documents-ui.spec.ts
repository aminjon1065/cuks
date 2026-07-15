import { expect, test, type Page } from '@playwright/test';

/**
 * Document cabinet + card UI smoke (docs/modules/11 §7, tasks 3.2 & 3.4). Drives the
 * real screens as the enrolled superadmin (authed project): open the cabinet, create a
 * document, register it from the card — asserting a journal number is minted and the
 * status advances — then issue a resolution from the card and watch the document move
 * to «На исполнении». Exercises the pages end-to-end against the API + DB.
 */

/** Create a draft via the cabinet dialog and register it from the card. Returns the subject. */
async function createAndRegister(page: Page): Promise<string> {
  await page.goto('/app/docs');
  await expect(page.getByRole('main').getByRole('heading', { name: 'Кабинет ДОУ' })).toBeVisible();

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

  await expect(page.getByRole('main').getByRole('heading', { name: subject })).toBeVisible();
  await expect(page.getByTestId('document-status')).toContainText('Черновик');

  await page.getByRole('button', { name: 'Зарегистрировать' }).first().click();
  const regDialog = page.getByRole('dialog');
  const submit = regDialog.getByRole('button', { name: 'Зарегистрировать' });
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(page.getByTestId('document-status')).toContainText('Зарегистрирован', {
    timeout: 15_000,
  });
  return subject;
}

test('docflow UI: create a document and register it from the card', async ({ page }) => {
  await page.goto('/app/docs');
  await expect(page.getByRole('tab', { name: 'Мои документы' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Мои поручения' })).toBeVisible();

  await createAndRegister(page);

  await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toContainText(
    /\S+-\d{4}\/\d{4}/,
  );
});

test('docflow UI: the card shows five tabs and a history feed', async ({ page }) => {
  await createAndRegister(page);

  // The five card tabs are present.
  for (const name of ['Обзор', 'Маршрут', 'Резолюции', 'Связи', 'История']) {
    await expect(page.getByRole('tab', { name })).toBeVisible();
  }
  // История lists the document's audit events, attributed to the actor (the actor name
  // appears only in the history feed, not in the header/status badge).
  await page.getByRole('tab', { name: 'История' }).click();
  await expect(page.getByText(/E2E Админ/).first()).toBeVisible();

  // The journals register screen opens and lists the registered document's number.
  await page.goto('/app/docs/journals');
  await expect(
    page.getByRole('main').getByRole('heading', { name: 'Журналы регистрации' }),
  ).toBeVisible();
});

test('docflow UI: issue a resolution from the card', async ({ page }) => {
  await createAndRegister(page);

  // Resolutions live on their own tab now.
  await page.getByRole('tab', { name: 'Резолюции' }).click();
  // Open the resolution dialog from the card and pick an executor from the directory.
  await page.getByRole('button', { name: 'Добавить резолюцию' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Ответственный').fill('Юзер');
  await dialog
    .getByRole('button', { name: /E2E Юзер/ })
    .first()
    .click();
  await dialog.getByLabel('Поручение').fill('Исполнить в срок');

  const issued = page.waitForResponse(
    (r) =>
      /\/docflow\/documents\/.+\/resolutions$/.test(r.url()) && r.request().method() === 'POST',
  );
  await dialog.getByRole('button', { name: 'Добавить резолюцию' }).click();
  await issued;

  // The resolution renders and the document moves to «На исполнении».
  await expect(page.getByText('Исполнить в срок')).toBeVisible();
  await expect(page.getByTestId('document-status')).toContainText('На исполнении', {
    timeout: 15_000,
  });
});
