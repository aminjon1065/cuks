import { expect, request, test, type APIRequestContext } from '@playwright/test';
import { apiLogin, csrfHeaders } from './support/api';
import { E2E_ADMIN, E2E_USER, STORAGE_STATE } from './support/fixtures';

/**
 * Acknowledgements / ознакомление (docs/modules/11 §6, task 3.6). Drives the real flow
 * over the API + PostgreSQL: an acknowledge route step assigned to a subdivision expands
 * into an acquaintance sheet (one row per member); each member sees it in «На ознакомление»
 * and marks it read; once everyone has, the step completes and the route advances.
 */
const API = 'http://localhost:3000';

interface DocumentDto {
  id: string;
  status: string;
}
interface SheetDto {
  rows: { userId: string; acknowledgedAt: string | null }[];
  total: number;
  acknowledged: number;
  canAcknowledge: boolean;
  stepId: string | null;
}
interface UserRow {
  id: string;
  username: string;
}

async function json<T>(res: { json: () => Promise<unknown> }): Promise<T> {
  return (await res.json()) as T;
}
async function jsonHeaders(ctx: APIRequestContext): Promise<Record<string, string>> {
  return { ...(await csrfHeaders(ctx)), 'content-type': 'application/json' };
}
async function users(admin: APIRequestContext): Promise<Record<string, string>> {
  const rows = (
    await json<{ items: UserRow[] }>(await admin.get('/api/v1/admin/users?page=1&limit=100'))
  ).items;
  return Object.fromEntries(rows.map((u) => [u.username, u.id]));
}

test('acknowledgements: an acknowledge step fans out to a subdivision and completes when all read', async () => {
  const admin = await request.newContext({ storageState: STORAGE_STATE, baseURL: API });
  const headers = await jsonHeaders(admin);
  const byName = await users(admin);
  const adminId = byName[E2E_ADMIN.username];
  const userId = byName[E2E_USER.username];

  // Build a subdivision with two members (the admin + e2e_user share one position).
  const unit = await json<{ id: string }>(
    await admin.post('/api/v1/admin/org-units', {
      headers,
      data: { name: `Отдел ознакомления ${Date.now()}`, type: 'division' },
    }),
  );
  const position = await json<{ id: string }>(
    await admin.post('/api/v1/admin/positions', {
      headers,
      data: { orgUnitId: unit.id, name: 'Сотрудник' },
    }),
  );
  for (const uid of [adminId, userId]) {
    const assigned = await admin.post('/api/v1/admin/user-positions', {
      headers,
      data: { userId: uid, positionId: position.id },
    });
    expect(assigned.ok(), `assign ${uid} ${assigned.status()}`).toBeTruthy();
  }

  // Draft an order and route it with a single acknowledge step on the whole subdivision.
  const doc = await json<DocumentDto>(
    await admin.post('/api/v1/docflow/documents', {
      headers,
      data: { docClass: 'internal', typeCode: 'order', subject: `Приказ ${Date.now()}` },
    }),
  );
  const routed = await admin.post(`/api/v1/docflow/documents/${doc.id}/route`, {
    headers,
    data: {
      steps: [{ order: 1, kind: 'acknowledge', assigneeType: 'org_unit', assigneeId: unit.id }],
    },
  });
  expect(routed.ok(), `route ${routed.status()}`).toBeTruthy();

  // The step expanded the sheet to both members, both still pending.
  const sheet0 = await json<SheetDto>(
    await admin.get(`/api/v1/docflow/documents/${doc.id}/acquaintances`),
  );
  expect(sheet0.total, 'the subdivision expanded to two members').toBe(2);
  expect(sheet0.acknowledged).toBe(0);
  expect(sheet0.canAcknowledge, 'the admin has a pending line').toBe(true);
  expect(sheet0.rows.map((r) => r.userId).sort()).toEqual([adminId, userId].sort());

  // The document shows up in the admin's «На ознакомление» queue.
  const queue = await json<{ items: DocumentDto[] }>(
    await admin.get('/api/v1/docflow/documents?queue=to_acknowledge&page=1&limit=50'),
  );
  expect(queue.items.some((d) => d.id === doc.id)).toBeTruthy();

  // The admin acknowledges — one down, the step stays active.
  const afterAdmin = await json<SheetDto>(
    await admin.post(`/api/v1/docflow/route-steps/${sheet0.stepId}/actions/acknowledge`, {
      headers,
      data: {},
    }),
  );
  expect(afterAdmin.acknowledged).toBe(1);
  expect(afterAdmin.canAcknowledge, 'the admin no longer has a pending line').toBe(false);
  expect(
    (await json<DocumentDto>(await admin.get(`/api/v1/docflow/documents/${doc.id}`))).status,
    'route still running while a member is pending',
  ).toBe('on_route');

  // The second member acknowledges — the step completes and the route advances.
  const member = await apiLogin(E2E_USER.username, E2E_USER.password);
  const memberSheet = await json<SheetDto>(
    await member.get(`/api/v1/docflow/documents/${doc.id}/acquaintances`),
  );
  expect(memberSheet.canAcknowledge, 'the member has a pending line').toBe(true);
  const done = await json<SheetDto>(
    await member.post(`/api/v1/docflow/route-steps/${memberSheet.stepId}/actions/acknowledge`, {
      headers: await jsonHeaders(member),
      data: {},
    }),
  );
  expect(done.acknowledged, 'everyone has acknowledged').toBe(2);
  expect(
    (await json<DocumentDto>(await admin.get(`/api/v1/docflow/documents/${doc.id}`))).status,
    'the completed acknowledge route moves the document to registration',
  ).toBe('pending_registration');

  await Promise.all([admin.dispose(), member.dispose()]);
});
