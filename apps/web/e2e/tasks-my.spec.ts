import { expect, request, test, type APIRequestContext } from '@playwright/test';
import { apiLogin, csrfHeaders } from './support/api';
import { E2E_USER2, STORAGE_STATE } from './support/fixtures';

/**
 * «Мои задачи» (docs/modules/15 §5, task 4.4). Drives the real API: the personal queue aggregates a
 * member's assigned active tasks across projects, the overdue count drives the sidebar badge,
 * quick-complete drops a task out of the queue, and the «watching» filter switches the source.
 */
const API = 'http://localhost:3000';

interface Card {
  id: string;
  seq: number;
}
interface MyTask {
  id: string;
  projectKey: string;
  title: string;
  dueAt: string | null;
}

async function j<T>(res: { json: () => Promise<unknown> }): Promise<T> {
  return (await res.json()) as T;
}
async function headers(ctx: APIRequestContext): Promise<Record<string, string>> {
  return { ...(await csrfHeaders(ctx)), 'content-type': 'application/json' };
}
const uniqueKey = () => `M${Date.now() % 1e9}`;
const daysFromNow = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();

async function directoryId(admin: APIRequestContext, username: string): Promise<string> {
  const rows = (
    await j<{ items: { id: string; username: string }[] }>(
      await admin.get('/api/v1/admin/users?page=1&limit=100'),
    )
  ).items;
  return rows.find((u) => u.username === username)!.id;
}

test('my tasks: aggregates assigned tasks, counts overdue, quick-completes and filters watched', async () => {
  const admin = await request.newContext({ storageState: STORAGE_STATE, baseURL: API });
  const h = await headers(admin);
  const user2Id = await directoryId(admin, E2E_USER2.username);

  // A project where user2 is an editor (so the assigned cards are member-scoped and openable).
  const project = await j<{ id: string; key: string }>(
    await admin.post('/api/v1/tasks/projects', {
      headers: h,
      data: { name: `My ${Date.now()}`, key: uniqueKey(), visibleToOrgUnit: false },
    }),
  );
  await admin.post(`/api/v1/tasks/projects/${project.id}/members`, {
    headers: h,
    data: { userId: user2Id, role: 'editor' },
  });
  const board = await j<{ columns: { id: string }[] }>(
    await admin.get(`/api/v1/tasks/projects/${project.id}/board`),
  );
  const col = board.columns[0]!.id;

  const makeCard = (data: Record<string, unknown>) =>
    admin
      .post(`/api/v1/tasks/projects/${project.id}/cards`, {
        headers: h,
        data: { columnId: col, ...data },
      })
      .then((r) => j<Card>(r));

  const overdue = await makeCard({
    title: 'Просрочено',
    assigneeIds: [user2Id],
    dueAt: daysFromNow(-2),
  });
  await makeCard({ title: 'Сегодня', assigneeIds: [user2Id], dueAt: daysFromNow(0) });
  await makeCard({ title: 'Без срока', assigneeIds: [user2Id] });
  // A card user2 only watches (not assigned).
  const watched = await makeCard({ title: 'Наблюдаю', assigneeIds: [] });

  const user2 = await apiLogin(E2E_USER2.username, E2E_USER2.password);
  const uh = await csrfHeaders(user2);
  await user2.post(`/api/v1/tasks/cards/${watched.id}/watch`, { headers: uh });

  // The queue aggregates across ALL projects/runs, so scope assertions to this project's key.
  const mineHere = async (watching = false) =>
    (await j<MyTask[]>(await user2.get(`/api/v1/tasks/my?watching=${watching}`)))
      .filter((m) => m.projectKey === project.key)
      .map((m) => m.title)
      .sort();
  const overdueCount = async () =>
    (await j<{ count: number }>(await user2.get('/api/v1/tasks/my/overdue-count'))).count;

  // Assigned queue for this project: the three assigned cards, not the watched one.
  expect(await mineHere()).toEqual(['Без срока', 'Просрочено', 'Сегодня']);

  // Overdue count is global; our overdue card contributes one — assert it drops on completion.
  const before = await overdueCount();
  expect(before).toBeGreaterThanOrEqual(1);
  expect(
    (await user2.post(`/api/v1/tasks/cards/${overdue.id}/complete`, { headers: uh })).ok(),
  ).toBeTruthy();
  expect(await overdueCount(), 'completing an overdue task drops the count by one').toBe(
    before - 1,
  );

  // The completed card leaves this project's queue.
  expect(await mineHere()).toEqual(['Без срока', 'Сегодня']);

  // The «watching» view surfaces the watched card, and not the merely-assigned one.
  const watching = await mineHere(true);
  expect(watching).toContain('Наблюдаю');
  expect(watching).not.toContain('Сегодня');

  await Promise.all([admin.dispose(), user2.dispose()]);
});
