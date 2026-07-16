import { expect, request, test, type APIRequestContext } from '@playwright/test';
import { csrfHeaders } from './support/api';
import { STORAGE_STATE } from './support/fixtures';

/**
 * Board screen smoke (docs/modules/15 §3, task 4.6). Drives the real board UI as the enrolled
 * superadmin: open a seeded board, see its card, and quick-add a card through the column composer.
 */
const API = 'http://localhost:3000';

async function j<T>(res: { json: () => Promise<unknown> }): Promise<T> {
  return (await res.json()) as T;
}

test('board UI: renders cards and quick-adds a new one', async ({ page }) => {
  const admin: APIRequestContext = await request.newContext({
    storageState: STORAGE_STATE,
    baseURL: API,
  });
  const h = { ...(await csrfHeaders(admin)), 'content-type': 'application/json' };
  const project = await j<{ id: string; key: string; name: string }>(
    await admin.post('/api/v1/tasks/projects', {
      headers: h,
      data: { name: `UI ${Date.now()}`, key: `U${Date.now() % 1e9}`, visibleToOrgUnit: false },
    }),
  );
  const board = await j<{ columns: { id: string }[] }>(
    await admin.get(`/api/v1/tasks/projects/${project.id}/board`),
  );
  await admin.post(`/api/v1/tasks/projects/${project.id}/cards`, {
    headers: h,
    data: { columnId: board.columns[0]!.id, title: 'Существующая карточка' },
  });
  await admin.dispose();

  await page.goto(`/app/tasks/projects/${project.key}`);
  // The board mounted (project name in the header) and the seeded card is on it.
  await expect(page.getByRole('heading', { name: project.name })).toBeVisible();
  await expect(page.getByText('Существующая карточка')).toBeVisible();

  // Quick-add a card through the first column's composer.
  await page.getByRole('button', { name: 'Добавить карточку' }).first().click();
  const input = page.getByPlaceholder('Название задачи…');
  await input.fill('UI карточка');
  const created = page.waitForResponse(
    (r) => r.url().endsWith('/cards') && r.request().method() === 'POST',
  );
  await input.press('Enter');
  await created;
  await expect(page.getByText('UI карточка')).toBeVisible();
});
