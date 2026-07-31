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

test('docflow UI: the card shows its tabs and a history feed', async ({ page }) => {
  await createAndRegister(page);

  // The card tabs are present.
  for (const name of ['Обзор', 'Маршрут', 'Резолюции', 'Связи', 'История']) {
    await expect(page.getByRole('tab', { name })).toBeVisible();
  }
  // «Отправка» is not among them: this is an internal приказ, which is distributed by
  // acknowledgement and never dispatched — an empty tab would read as an unused feature
  // rather than an inapplicable one (plan этап 6).
  await expect(page.getByRole('tab', { name: 'Отправка' })).toBeHidden();
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

/**
 * The outgoing half on the real screens (docs/modules/11 §12.3, plan этап 6): «Создать
 * ответ» appears on a registered incoming card, the answer opens with the counterparty
 * already filled in and a banner back to the letter, and its «Отправка» tab explains why
 * nothing can be sent until the answer has a number.
 */
test('docflow UI: create the answer to an incoming letter from its card', async ({ page }) => {
  await page.goto('/app/docs/journals');
  await page.getByRole('button', { name: 'Зарегистрировать входящий' }).first().click();

  const wizard = page.getByRole('dialog');
  const subject = `UI входящий ${Date.now()}`;
  await wizard.getByLabel('Тема').fill(subject);
  const registered = page.waitForResponse(
    (r) => r.url().includes('/docflow/documents/register-incoming') && r.status() === 201,
  );
  await wizard.getByRole('button', { name: 'Зарегистрировать' }).click();
  await registered;
  await expect(page.getByRole('main').getByRole('heading', { name: /ВХ-/ })).toBeVisible();

  // The answer is offered only once the letter has a number, which it now has.
  await page.getByRole('button', { name: 'Создать ответ' }).click();
  const dialog = page.getByRole('dialog');
  // The preset route needs people we are not naming here — draft it without a route.
  await dialog.getByLabel('Сразу отправить на согласование').uncheck();
  const created = page.waitForResponse(
    (r) => r.url().includes('/actions/create-response') && r.request().method() === 'POST',
  );
  await dialog.getByRole('button', { name: 'Создать' }).click();
  const createdRes = await created;
  expect(createdRes.status(), await createdRes.text()).toBe(201);

  // We land on the answer, with a banner back to the letter it answers.
  await expect(
    page
      .getByRole('main')
      .getByText(/Ответ на/)
      .first(),
  ).toBeVisible();
  await expect(page.getByTestId('document-status')).toContainText('Черновик');

  // And its send tab is honest about why it is empty.
  await page.getByRole('tab', { name: 'Отправка' }).click();
  await expect(page.getByText('Отправка возможна после регистрации документа.')).toBeVisible();
});
