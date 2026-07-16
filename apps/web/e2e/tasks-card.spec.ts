import { expect, request, test, type APIRequestContext } from '@playwright/test';
import { apiLogin, csrfHeaders } from './support/api';
import { E2E_USER2, STORAGE_STATE } from './support/fixtures';

/**
 * Task-card SidePanel API (docs/modules/15 §4, task 4.3). Drives the real API + PostgreSQL: full-card
 * read, per-field edit with the «История» trail, checklist CRUD, assignment / mention / status
 * notifications to project members, complete/copy, and the viewer read-but-not-mutate boundary.
 */
const API = 'http://localhost:3000';

interface Card {
  id: string;
  seq: number;
  columnId: string;
  title: string;
  priority: string;
  assigneeIds: string[];
  watcherIds: string[];
  completedAt: string | null;
  checklist: { id: string; text: string; isDone: boolean }[];
  commentCount: number;
}
interface Board {
  project: { id: string; key: string };
  columns: { id: string; isDoneColumn: boolean }[];
}
interface Activity {
  action: string;
  meta: Record<string, unknown> | null;
}
interface Notif {
  type: string;
  entityId: string | null;
}

async function j<T>(res: { json: () => Promise<unknown> }): Promise<T> {
  return (await res.json()) as T;
}
async function headers(ctx: APIRequestContext): Promise<Record<string, string>> {
  return { ...(await csrfHeaders(ctx)), 'content-type': 'application/json' };
}
const uniqueKey = () => `C${Date.now() % 1e9}`;

async function directoryId(admin: APIRequestContext, username: string): Promise<string> {
  const rows = (
    await j<{ items: { id: string; username: string }[] }>(
      await admin.get('/api/v1/admin/users?page=1&limit=100'),
    )
  ).items;
  return rows.find((u) => u.username === username)!.id;
}
async function makeCard(
  admin: APIRequestContext,
  h: Record<string, string>,
): Promise<{ board: Board; card: Card }> {
  const project = await j<{ id: string; key: string }>(
    await admin.post('/api/v1/tasks/projects', {
      headers: h,
      data: { name: `Card ${Date.now()}`, key: uniqueKey(), visibleToOrgUnit: false },
    }),
  );
  const board = await j<Board>(await admin.get(`/api/v1/tasks/projects/${project.id}/board`));
  const card = await j<Card>(
    await admin.post(`/api/v1/tasks/projects/${project.id}/cards`, {
      headers: h,
      data: { columnId: board.columns[0]!.id, title: 'Задача' },
    }),
  );
  return { board, card };
}
async function addMember(
  admin: APIRequestContext,
  h: Record<string, string>,
  projectId: string,
  userId: string,
  role: 'viewer' | 'editor',
): Promise<void> {
  await admin.post(`/api/v1/tasks/projects/${projectId}/members`, {
    headers: h,
    data: { userId, role },
  });
}
async function tasksNotifications(ctx: APIRequestContext): Promise<Notif[]> {
  return (await j<{ items: Notif[] }>(await ctx.get('/api/v1/notifications?group=tasks&limit=100')))
    .items;
}

test('card: full detail, per-field edit and the История trail', async () => {
  const admin = await request.newContext({ storageState: STORAGE_STATE, baseURL: API });
  const h = await headers(admin);
  const { card } = await makeCard(admin, h);

  const detail = await j<Card>(await admin.get(`/api/v1/tasks/cards/${card.id}`));
  expect(detail.checklist).toEqual([]);
  expect(detail.priority).toBe('p3');

  await admin.patch(`/api/v1/tasks/cards/${card.id}`, {
    headers: h,
    data: { title: 'Обновлено', priority: 'p1' },
  });
  const edited = await j<Card>(await admin.get(`/api/v1/tasks/cards/${card.id}`));
  expect(edited.title).toBe('Обновлено');
  expect(edited.priority).toBe('p1');

  const activity = await j<Activity[]>(await admin.get(`/api/v1/tasks/cards/${card.id}/activity`));
  const actions = activity.map((a) => a.action);
  expect(actions).toContain('tasks.card.created');
  expect(actions).toContain('tasks.card.updated');

  await admin.dispose();
});

test('card: checklist add / toggle / delete drives the completion counts', async () => {
  const admin = await request.newContext({ storageState: STORAGE_STATE, baseURL: API });
  const h = await headers(admin);
  const { card } = await makeCard(admin, h);

  const one = await j<Card['checklist']>(
    await admin.post(`/api/v1/tasks/cards/${card.id}/checklist`, {
      headers: h,
      data: { text: 'Пункт 1' },
    }),
  );
  await admin.post(`/api/v1/tasks/cards/${card.id}/checklist`, {
    headers: h,
    data: { text: 'Пункт 2' },
  });
  await admin.patch(`/api/v1/tasks/cards/${card.id}/checklist/${one[0]!.id}`, {
    headers: h,
    data: { isDone: true },
  });

  const detail = await j<Card>(await admin.get(`/api/v1/tasks/cards/${card.id}`));
  expect(detail.checklist).toHaveLength(2);
  expect(detail.checklist.filter((i) => i.isDone)).toHaveLength(1);

  const afterDelete = await j<Card['checklist']>(
    await admin.delete(`/api/v1/tasks/cards/${card.id}/checklist/${one[0]!.id}`, {
      headers: await csrfHeaders(admin),
    }),
  );
  expect(afterDelete).toHaveLength(1);

  await admin.dispose();
});

test('card: assignment and @-mention notify project members; status change notifies watchers', async () => {
  const admin = await request.newContext({ storageState: STORAGE_STATE, baseURL: API });
  const h = await headers(admin);
  const user2Id = await directoryId(admin, E2E_USER2.username);
  const { board, card } = await makeCard(admin, h);
  await addMember(admin, h, board.project.id, user2Id, 'editor');

  // Assign user2 → they are notified.
  await admin.patch(`/api/v1/tasks/cards/${card.id}`, {
    headers: h,
    data: { assigneeIds: [user2Id] },
  });
  // @-mention user2 in a comment → they are notified.
  await admin.post(`/api/v1/tasks/cards/${card.id}/comments`, {
    headers: h,
    data: { body: 'Прошу посмотреть @Пользователь', mentionIds: [user2Id] },
  });
  // user2 watches, admin moves the card → watcher is notified of the status change.
  const user2 = await apiLogin(E2E_USER2.username, E2E_USER2.password);
  await user2.post(`/api/v1/tasks/cards/${card.id}/watch`, { headers: await csrfHeaders(user2) });
  await admin.post(`/api/v1/tasks/cards/${card.id}/move`, {
    headers: h,
    data: { columnId: board.columns[1]!.id, afterTaskId: null },
  });

  // Notifications are dispatched best-effort (fire-and-forget) — poll until all three land.
  await expect
    .poll(
      async () => {
        const types = (await tasksNotifications(user2))
          .filter((n) => n.entityId === card.id)
          .map((n) => n.type);
        return ['tasks.card.assigned', 'tasks.comment.mention', 'tasks.card.status_changed'].every(
          (want) => types.includes(want),
        );
      },
      { timeout: 5000 },
    )
    .toBe(true);

  await Promise.all([admin.dispose(), user2.dispose()]);
});

test('card: a viewer may read and comment but not edit fields or the checklist', async () => {
  const admin = await request.newContext({ storageState: STORAGE_STATE, baseURL: API });
  const h = await headers(admin);
  const user2Id = await directoryId(admin, E2E_USER2.username);
  const { board, card } = await makeCard(admin, h);
  await addMember(admin, h, board.project.id, user2Id, 'viewer');

  const user2 = await apiLogin(E2E_USER2.username, E2E_USER2.password);
  const uh = await headers(user2);
  expect(
    (await user2.get(`/api/v1/tasks/cards/${card.id}`)).ok(),
    'viewer reads the card',
  ).toBeTruthy();
  expect(
    (
      await user2.post(`/api/v1/tasks/cards/${card.id}/comments`, {
        headers: uh,
        data: { body: 'Комментарий наблюдателя', mentionIds: [] },
      })
    ).ok(),
    'viewer may comment',
  ).toBeTruthy();
  expect(
    (
      await user2.patch(`/api/v1/tasks/cards/${card.id}`, {
        headers: uh,
        data: { title: 'Нельзя' },
      })
    ).status(),
    'viewer may not edit fields',
  ).toBe(403);
  expect(
    (
      await user2.post(`/api/v1/tasks/cards/${card.id}/checklist`, {
        headers: uh,
        data: { text: 'Нельзя' },
      })
    ).status(),
    'viewer may not add checklist items',
  ).toBe(403);

  await Promise.all([admin.dispose(), user2.dispose()]);
});

test('card: complete moves into the done column and copy duplicates the card', async () => {
  const admin = await request.newContext({ storageState: STORAGE_STATE, baseURL: API });
  const h = await headers(admin);
  const { board, card } = await makeCard(admin, h);

  const completed = await j<Card>(
    await admin.post(`/api/v1/tasks/cards/${card.id}/complete`, {
      headers: await csrfHeaders(admin),
    }),
  );
  expect(completed.columnId).toBe(board.columns[2]!.id);
  expect(completed.completedAt).toBeTruthy();

  const copy = await j<Card>(
    await admin.post(`/api/v1/tasks/cards/${card.id}/copy`, { headers: await csrfHeaders(admin) }),
  );
  expect(copy.id).not.toBe(card.id);
  expect(copy.seq).not.toBe(card.seq);
  expect(copy.title).toContain('копия');

  await admin.dispose();
});
