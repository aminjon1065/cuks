import { expect, request, test, type APIRequestContext } from '@playwright/test';
import { apiLogin, csrfHeaders } from './support/api';
import { E2E_USER, STORAGE_STATE } from './support/fixtures';

/**
 * The exchange review queue (plan этап 10).
 *
 * The queue is only reachable with a transport configured, and the dev api may not have one —
 * so the API tests here assert the GATE and the shape, which hold either way, and the UI test
 * asserts that the screen states plainly when there is nothing to review. What happens to a
 * real message end to end is covered by the unit policy tests and was verified against a live
 * folder adapter.
 */
const API = 'http://localhost:3000';

interface Page {
  items: {
    id: string;
    status: string;
    canRegister: boolean;
    blockedBy: string | null;
    attachments: { avStatus: string | null }[];
  }[];
  total: number;
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

test('exchange queue: the chancellery sees it and an employee does not', async () => {
  const admin = await request.newContext({ storageState: STORAGE_STATE, baseURL: API });
  const listed = await admin.get('/api/v1/docflow/exchange/inbound?page=1&limit=25');
  expect(listed.ok(), `list ${listed.status()} ${await listed.text()}`).toBeTruthy();
  const page = await json<Page>(listed);
  expect(page.total).toBeGreaterThanOrEqual(0);

  // Every row the queue returns must state whether it can be registered and, when it cannot,
  // why — a disabled button with no explanation reads as a broken screen.
  for (const item of page.items) {
    expect(typeof item.canRegister).toBe('boolean');
    if (!item.canRegister) expect(item.blockedBy).toBeTruthy();
  }

  // Registering mints a number, so the queue is chancellery work.
  const other = await apiLogin(E2E_USER.username, E2E_USER.password);
  expect((await other.get('/api/v1/docflow/exchange/inbound')).status()).toBe(403);

  await Promise.all([admin.dispose(), other.dispose()]);
});

test('exchange queue: a message that is not waiting cannot be decided twice', async () => {
  const admin = await request.newContext({ storageState: STORAGE_STATE, baseURL: API });
  const headers = await jsonHeaders(admin);

  // An id that is not in the queue at all: the register action refuses rather than inventing
  // a document, and says so with a stable code.
  const missing = '019fbb96-0000-7000-8000-000000000000';
  const res = await admin.post(`/api/v1/docflow/exchange/inbound/${missing}/actions/register`, {
    headers,
    data: {
      journalId: missing,
      typeCode: 'letter',
      correspondentId: missing,
      confidentiality: 'normal',
    },
  });
  expect(res.status()).toBe(404);
  expect((await json<ErrorBody>(res)).error?.code).toBe('docflow.exchange.not_found');

  // A refusal must carry a reason: one nobody can explain is one nobody can review.
  const noReason = await admin.post(`/api/v1/docflow/exchange/inbound/${missing}/actions/reject`, {
    headers,
    data: { reason: '   ' },
  });
  expect(noReason.status()).toBe(400);

  await admin.dispose();
});

test('exchange UI: the queue explains itself when there is nothing to review', async ({ page }) => {
  await page.goto('/app/docs/exchange');
  await expect(
    page.getByRole('main').getByRole('heading', { name: 'Обмен: разбор входящих' }),
  ).toBeVisible();

  // The filter defaults to «ждут разбора» — the reason somebody opened the screen.
  await expect(page.getByLabel('Состояние')).toHaveValue('');

  const cards = page.getByRole('main').locator('li');
  if ((await cards.count()) === 0) {
    await expect(page.getByText('Разбирать нечего')).toBeVisible();
  } else {
    // Whatever is in the queue, the register control is never offered without the server
    // having said it may be: a screen that offers a button the API refuses is worse than one
    // that explains the wait.
    const first = cards.first();
    const register = first.getByRole('button', { name: 'Зарегистрировать' });
    if (await register.isEnabled().catch(() => false)) {
      await register.click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await expect(page.getByLabel('Журнал регистрации')).toBeVisible();
      await page.getByRole('button', { name: 'Отмена' }).click();
    } else {
      await expect(first).toContainText(/Ожидает проверки антивирусом|Антивирус отметил/);
    }
  }
});
