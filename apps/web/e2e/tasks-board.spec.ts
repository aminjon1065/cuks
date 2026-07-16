import { expect, request, test, type APIRequestContext } from '@playwright/test';
import { apiLogin, csrfHeaders } from './support/api';
import { E2E_ADMIN, E2E_USER2, STORAGE_STATE } from './support/fixtures';

/**
 * Kanban board (docs/modules/15 §3/§8, task 4.2). Drives the real API + PostgreSQL: a project is
 * created with default columns, a card is added and dragged into the done column (which completes
 * it), 50 concurrent card creations mint a gap-free per-project sequence, and a viewer may see the
 * board but not mutate it. The two-client realtime is covered in task 4.6.
 */
const API = 'http://localhost:3000';

interface ProjectDto {
  id: string;
  key: string;
}
interface ColumnDto {
  id: string;
  isDoneColumn: boolean;
}
interface CardDto {
  id: string;
  seq: number;
  columnId: string;
  orderKey: string;
  completedAt: string | null;
}
interface BoardDto {
  project: ProjectDto;
  columns: ColumnDto[];
  cards: CardDto[];
}

async function json<T>(res: { json: () => Promise<unknown> }): Promise<T> {
  return (await res.json()) as T;
}
async function jsonHeaders(ctx: APIRequestContext): Promise<Record<string, string>> {
  return { ...(await csrfHeaders(ctx)), 'content-type': 'application/json' };
}
async function userIds(admin: APIRequestContext): Promise<Record<string, string>> {
  const rows = (
    await json<{ items: { id: string; username: string }[] }>(
      await admin.get('/api/v1/admin/users?page=1&limit=100'),
    )
  ).items;
  return Object.fromEntries(rows.map((u) => [u.username, u.id]));
}
/** A unique ≤12-char project key so re-runs never collide (seed:e2e does not wipe tasks). */
const uniqueKey = () => `T${Date.now() % 1e9}`;

async function createProject(
  admin: APIRequestContext,
  headers: Record<string, string>,
): Promise<ProjectDto> {
  return json<ProjectDto>(
    await admin.post('/api/v1/tasks/projects', {
      headers,
      data: { name: `Board ${Date.now()}`, key: uniqueKey(), visibleToOrgUnit: false },
    }),
  );
}
const board = async (ctx: APIRequestContext, id: string) =>
  json<BoardDto>(await ctx.get(`/api/v1/tasks/projects/${id}/board`));

test('board: create → card → drag into the done column completes it', async () => {
  const admin = await request.newContext({ storageState: STORAGE_STATE, baseURL: API });
  const headers = await jsonHeaders(admin);
  const project = await createProject(admin, headers);

  // A new project starts with three default columns, the last of which is a done column.
  const b0 = await board(admin, project.id);
  expect(b0.columns).toHaveLength(3);
  expect(b0.columns[2]!.isDoneColumn).toBe(true);
  expect(b0.cards).toHaveLength(0);

  // Add a card to the first column — it is not complete.
  const card = await json<CardDto>(
    await admin.post(`/api/v1/tasks/projects/${project.id}/cards`, {
      headers,
      data: { columnId: b0.columns[0]!.id, title: 'Первая задача' },
    }),
  );
  expect(card.seq).toBe(1);
  expect(card.completedAt).toBeNull();

  // Drag it into the done column — it completes.
  const moved = await json<CardDto>(
    await admin.post(`/api/v1/tasks/cards/${card.id}/move`, {
      headers,
      data: { columnId: b0.columns[2]!.id, afterTaskId: null },
    }),
  );
  expect(moved.columnId).toBe(b0.columns[2]!.id);
  expect(moved.completedAt, 'entering the done column completes the card').toBeTruthy();

  await admin.dispose();
});

test('board: 50 concurrent card creations mint a unique, gap-free sequence', async () => {
  const admin = await request.newContext({ storageState: STORAGE_STATE, baseURL: API });
  const headers = await jsonHeaders(admin);
  const project = await createProject(admin, headers);
  const columnId = (await board(admin, project.id)).columns[0]!.id;

  const N = 50;
  const created = await Promise.all(
    Array.from({ length: N }, (_, i) =>
      admin.post(`/api/v1/tasks/projects/${project.id}/cards`, {
        headers,
        data: { columnId, title: `Card ${i}` },
      }),
    ),
  );
  expect(created.every((r) => r.ok())).toBe(true);
  const seqs = (await Promise.all(created.map((r) => json<CardDto>(r).then((c) => c.seq)))).sort(
    (a, b) => a - b,
  );
  expect(new Set(seqs).size, 'all sequence numbers are unique').toBe(N);
  expect(seqs, 'the sequence is 1..N with no gaps').toEqual(
    Array.from({ length: N }, (_, i) => i + 1),
  );

  await admin.dispose();
});

test('board: concurrent moves stay consistent — no duplicate order keys, no wedge', async () => {
  const admin = await request.newContext({ storageState: STORAGE_STATE, baseURL: API });
  const headers = await jsonHeaders(admin);
  const project = await createProject(admin, headers);
  const cols = (await board(admin, project.id)).columns;
  const [src, dst] = [cols[0]!.id, cols[1]!.id];

  const cards = await Promise.all(
    Array.from({ length: 6 }, (_, i) =>
      admin
        .post(`/api/v1/tasks/projects/${project.id}/cards`, {
          headers,
          data: { columnId: src, title: `C${i}` },
        })
        .then((r) => json<CardDto>(r)),
    ),
  );

  // Every card races into the SAME slot (top of dst) at once — before the tx+row-lock fix these
  // read identical neighbours and minted the same order key.
  const moves = await Promise.all(
    cards.map((c) =>
      admin.post(`/api/v1/tasks/cards/${c.id}/move`, {
        headers,
        data: { columnId: dst, afterTaskId: null },
      }),
    ),
  );
  expect(moves.every((r) => r.ok())).toBe(true);

  const after = (await board(admin, project.id)).cards.filter((c) => c.columnId === dst);
  const keys = after.map((c) => c.orderKey);
  expect(new Set(keys).size, 'order keys within a column are all distinct').toBe(keys.length);

  // A further insert between two neighbours must not wedge on keyBetween(k, k) → 500.
  const ordered = [...after].sort((a, b) => (a.orderKey < b.orderKey ? -1 : 1));
  const between = await admin.post(`/api/v1/tasks/cards/${ordered.at(-1)!.id}/move`, {
    headers,
    data: { columnId: dst, afterTaskId: ordered[0]!.id },
  });
  expect(between.ok(), 'inserting between two cards still succeeds').toBeTruthy();

  await admin.dispose();
});

test('board: the sole owner cannot demote themselves and orphan the project', async () => {
  const admin = await request.newContext({ storageState: STORAGE_STATE, baseURL: API });
  const headers = await jsonHeaders(admin);
  const adminId = (await userIds(admin))[E2E_ADMIN.username];
  const project = await createProject(admin, headers);

  // The creator is the sole owner; demoting themselves to viewer must be refused (keep-one-owner).
  const demote = await admin.post(`/api/v1/tasks/projects/${project.id}/members`, {
    headers,
    data: { userId: adminId, role: 'viewer' },
  });
  expect(demote.status(), 'demoting the last owner is rejected').toBe(400);

  await admin.dispose();
});

test('board: a viewer sees the board but may not mutate it', async () => {
  const admin = await request.newContext({ storageState: STORAGE_STATE, baseURL: API });
  const headers = await jsonHeaders(admin);
  const viewerId = (await userIds(admin))[E2E_USER2.username];
  const project = await createProject(admin, headers);
  const b = await board(admin, project.id);

  // Grant e2e_user2 the viewer role.
  await admin.post(`/api/v1/tasks/projects/${project.id}/members`, {
    headers,
    data: { userId: viewerId, role: 'viewer' },
  });

  const viewer = await apiLogin(E2E_USER2.username, E2E_USER2.password);
  // The viewer can load the board…
  expect((await viewer.get(`/api/v1/tasks/projects/${project.id}/board`)).ok()).toBeTruthy();
  // …but cannot create a card (editor required) → 403.
  const denied = await viewer.post(`/api/v1/tasks/projects/${project.id}/cards`, {
    headers: await jsonHeaders(viewer),
    data: { columnId: b.columns[0]!.id, title: 'Нельзя' },
  });
  expect(denied.status(), 'a viewer may not create cards').toBe(403);

  await Promise.all([admin.dispose(), viewer.dispose()]);
});
