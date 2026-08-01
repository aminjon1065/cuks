import { expect, request, test, type APIRequestContext } from '@playwright/test';
import { apiLogin, csrfHeaders } from './support/api';
import { E2E_USER, STORAGE_STATE } from './support/fixtures';

/**
 * Saved register views and the filter panel (plan этап 9).
 *
 * The interesting claims are all about isolation and about what a preset may contain: a view
 * holds FILTERS, so sharing one is safe — each colleague still sees only their own documents —
 * and a view that could hold arbitrary keys would be a place to stash whatever the client
 * later pastes into a URL.
 */
const API = 'http://localhost:3000';

interface ViewDto {
  id: string;
  name: string;
  params: Record<string, string>;
  isShared: boolean;
  ownerName: string | null;
  canManage: boolean;
}
interface ErrorBody {
  error?: { code?: string };
}

async function json<T>(res: { json: () => Promise<unknown> }): Promise<T> {
  return (await res.json()) as T;
}
async function jsonHeaders(ctx: APIRequestContext): Promise<Record<string, string>> {
  return { ...(await csrfHeaders(ctx)), 'content-type': 'application/json' };
}

test('views: save, rename, apply and delete a register preset', async () => {
  const admin = await request.newContext({ storageState: STORAGE_STATE, baseURL: API });
  const headers = await jsonHeaders(admin);
  const name = `Просроченные ${Date.now()}`;

  const created = await admin.post('/api/v1/docflow/views', {
    headers,
    data: { name, params: { queue: 'registry', overdue: 'true', docClass: 'incoming' } },
  });
  expect(created.ok(), `create ${created.status()} ${await created.text()}`).toBeTruthy();
  const view = await json<ViewDto>(created);
  expect(view.params).toEqual({ queue: 'registry', overdue: 'true', docClass: 'incoming' });
  expect(view.canManage, 'my own view is mine to change').toBe(true);
  expect(view.ownerName, 'no owner label on my own').toBeNull();

  // The preset is exactly a set of register filters, so applying it must produce a list the
  // register itself would produce for the same query string.
  const listed = await admin.get(
    `/api/v1/docflow/documents?page=1&limit=5&${new URLSearchParams(view.params).toString()}`,
  );
  expect(listed.ok(), `apply ${listed.status()} ${await listed.text()}`).toBeTruthy();

  const renamed = await json<ViewDto>(
    await admin.patch(`/api/v1/docflow/views/${view.id}`, {
      headers,
      data: { name: `${name} (уточнённый)` },
    }),
  );
  expect(renamed.name).toBe(`${name} (уточнённый)`);
  expect(renamed.params, 'a rename does not touch the filters').toEqual(view.params);

  const removed = await admin.delete(`/api/v1/docflow/views/${view.id}`, {
    headers: await csrfHeaders(admin),
  });
  expect(removed.status()).toBe(204);
  // Gone means gone: a second delete is a 404, not a silent success.
  const again = await admin.delete(`/api/v1/docflow/views/${view.id}`, {
    headers: await csrfHeaders(admin),
  });
  expect(again.status()).toBe(404);

  await admin.dispose();
});

test('views: a preset may only carry known filters', async () => {
  const admin = await request.newContext({ storageState: STORAGE_STATE, baseURL: API });
  const headers = await jsonHeaders(admin);

  // `params` is a jsonb column and its contents end up in a query string, so anything outside
  // the register's own filter names is refused at the DTO rather than stored and replayed.
  // Built with fromEntries, not as literals: `{ __proto__: … }` in an object literal sets the
  // prototype and serialises to `{}`, which is a perfectly valid empty preset — the test would
  // have passed by testing nothing.
  for (const params of [
    Object.fromEntries([['redirect', 'https://example.invalid']]),
    Object.fromEntries([['__proto__', 'x']]),
    Object.fromEntries([['constructor', 'x']]),
    Object.fromEntries([
      ['queue', 'registry'],
      ['script', '<script>'],
    ]),
  ]) {
    const res = await admin.post('/api/v1/docflow/views', {
      headers,
      data: { name: 'Плохой', params },
    });
    expect(res.status(), JSON.stringify(params)).toBe(400);
    // Two different refusals, both correct: the DTO's allow-list rejects an unknown filter,
    // and Fastify's own parser rejects `__proto__` in a body before the DTO is even reached.
    // The test asserts that neither is stored, not which layer said no.
    const code = (await json<ErrorBody>(res)).error?.code;
    expect(['common.request.validation_failed', 'common.http.400']).toContain(code);
  }

  await admin.dispose();
});

test('views: a shared preset is offered but stays its author’s, and shows each reader their own', async () => {
  const admin = await request.newContext({ storageState: STORAGE_STATE, baseURL: API });
  const headers = await jsonHeaders(admin);
  const name = `Общий вид ${Date.now()}`;
  const shared = await json<ViewDto>(
    await admin.post('/api/v1/docflow/views', {
      headers,
      data: { name, params: { queue: 'mine' }, isShared: true },
    }),
  );

  const other = await apiLogin(E2E_USER.username, E2E_USER.password);
  const theirs = await json<ViewDto[]>(await other.get('/api/v1/docflow/views'));
  const seen = theirs.find((v) => v.id === shared.id);
  expect(seen, 'a shared view reaches a colleague').toBeTruthy();
  expect(seen!.canManage, 'but it is not theirs to change').toBe(false);
  expect(seen!.ownerName, 'and it says whose it is').toBeTruthy();

  // Read-only means read-only on the server, whatever the UI renders.
  const rename = await other.patch(`/api/v1/docflow/views/${shared.id}`, {
    headers: await jsonHeaders(other),
    data: { name: 'Присвоено' },
  });
  expect(rename.status()).toBe(404);
  const remove = await other.delete(`/api/v1/docflow/views/${shared.id}`, {
    headers: await csrfHeaders(other),
  });
  expect(remove.status()).toBe(404);

  // The point of sharing filters rather than results: the same preset gives each person their
  // own register, so a colleague never inherits the author's documents.
  const mineForAuthor = await json<{ total: number }>(
    await admin.get('/api/v1/docflow/documents?page=1&limit=1&queue=mine'),
  );
  const mineForOther = await json<{ total: number }>(
    await other.get('/api/v1/docflow/documents?page=1&limit=1&queue=mine'),
  );
  expect(mineForAuthor.total).not.toBe(mineForOther.total);

  await admin.delete(`/api/v1/docflow/views/${shared.id}`, { headers: await csrfHeaders(admin) });
  await Promise.all([admin.dispose(), other.dispose()]);
});

test('views: a private preset never reaches anybody else', async () => {
  const admin = await request.newContext({ storageState: STORAGE_STATE, baseURL: API });
  const headers = await jsonHeaders(admin);
  const name = `Личный вид ${Date.now()}`;
  const mine = await json<ViewDto>(
    await admin.post('/api/v1/docflow/views', {
      headers,
      data: { name, params: { queue: 'drafts' }, isShared: false },
    }),
  );

  const other = await apiLogin(E2E_USER.username, E2E_USER.password);
  const theirs = await json<ViewDto[]>(await other.get('/api/v1/docflow/views'));
  expect(theirs.map((v) => v.id)).not.toContain(mine.id);
  expect(JSON.stringify(theirs), 'not even the name').not.toContain(name);

  await admin.delete(`/api/v1/docflow/views/${mine.id}`, { headers: await csrfHeaders(admin) });
  await Promise.all([admin.dispose(), other.dispose()]);
});

test('register UI: filters live in the URL, show as chips and save as a view', async ({ page }) => {
  // Arriving by link is the whole point of URL filters: the dashboard drill-downs and a
  // colleague's «посмотри вот это» both land here.
  await page.goto('/app/docs?queue=registry&docClass=incoming');
  await expect(page.getByRole('main').getByRole('heading', { name: 'Кабинет ДОУ' })).toBeVisible();
  await expect(page.getByRole('tab', { name: /Реестр/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByLabel('Класс')).toHaveValue('incoming');

  // The active filter is stated as a removable chip, not left for the reader to spot in a
  // dropdown.
  const chip = page.getByText('Входящие', { exact: true }).last();
  await expect(chip).toBeVisible();
  await page.getByRole('button', { name: 'Убрать фильтр «Входящие»' }).click();
  await expect(page).toHaveURL(/queue=registry/);
  await expect(page).not.toHaveURL(/docClass=incoming/);

  // And the current set can be kept by name.
  const name = `UI вид ${Date.now()}`;
  await page.getByRole('button', { name: 'Сохранить вид' }).click();
  await page.getByLabel('Название').fill(name);
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await expect(page.getByRole('button', { name, exact: true })).toBeVisible();

  await page.getByRole('button', { name: `Удалить «${name}»` }).click();
  await page.getByRole('button', { name: 'Удалить', exact: true }).click();
  await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
});

test('register UI: a drill-down filter actually reaches the API', async ({ page }) => {
  // The failure this guards against was assertive rather than silent: the chip said
  // «Просрочено», the dropdown looked applied, and the request behind them asked for the
  // whole register. A screen that states a filter it did not send is worse than one with no
  // filter at all.
  const listCalls: string[] = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.pathname.endsWith('/docflow/documents')) listCalls.push(u.search);
  });

  await page.goto('/app/docs?queue=registry&overdue=true');
  await expect(page.getByRole('main').getByRole('heading', { name: 'Кабинет ДОУ' })).toBeVisible();
  await expect(page.getByText('Просрочено', { exact: true })).toBeVisible();
  await expect
    .poll(() => listCalls.some((s) => s.includes('overdue=true')), {
      message: 'the register asked for the overdue filter',
    })
    .toBe(true);

  listCalls.length = 0;
  await page.goto('/app/docs?queue=registry&docClass=outgoing&awaitingDispatch=true');
  await expect(page.getByText('Ожидают отправки', { exact: true })).toBeVisible();
  await expect
    .poll(() => listCalls.some((s) => s.includes('awaitingDispatch=true')), {
      message: 'and for the awaiting-dispatch filter',
    })
    .toBe(true);
});
