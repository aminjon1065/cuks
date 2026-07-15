import { expect, request, test, type APIRequestContext } from '@playwright/test';
import { apiLogin, csrfHeaders } from './support/api';
import { E2E_USER, E2E_USER2, STORAGE_STATE } from './support/fixtures';

/**
 * Document routes (docs/modules/11 §3/§4, task 3.3). Drives the real engine over the
 * API + PostgreSQL: a document is sent to a two-step sequential approval route, each
 * approver advances it, and completion moves the document to `pending_registration`;
 * a rejection returns it to the author as `draft`. The superadmin storageState authors
 * and routes; e2e_user / e2e_user2 are the assigned approvers.
 */
const API = 'http://localhost:3000';

interface DocumentDto {
  id: string;
  status: string;
}
interface RouteStepDto {
  id: string;
  stepOrder: number;
  status: string;
  canAct: boolean;
}
interface RouteDto {
  status: string;
  steps: RouteStepDto[];
}
interface UserRow {
  id: string;
  username: string;
}

async function json<T>(res: { json: () => Promise<unknown> }): Promise<T> {
  return (await res.json()) as T;
}

async function createDraft(
  admin: APIRequestContext,
  headers: Record<string, string>,
): Promise<string> {
  const res = await admin.post('/api/v1/docflow/documents', {
    headers,
    data: {
      docClass: 'internal',
      typeCode: 'order',
      subject: `Route ${Date.now()}-${Math.round(performance.now())}`,
    },
  });
  expect(res.ok(), `create ${res.status()}`).toBeTruthy();
  return (await json<DocumentDto>(res)).id;
}

/** Approve the caller's active step on the document; returns the refreshed routes. */
async function approve(ctx: APIRequestContext, documentId: string): Promise<RouteDto[]> {
  const routes = await json<RouteDto[]>(
    await ctx.get(`/api/v1/docflow/documents/${documentId}/routes`),
  );
  const step = routes[0]?.steps.find((s) => s.canAct);
  expect(step, 'the caller has an actionable step').toBeTruthy();
  const res = await ctx.post(`/api/v1/docflow/route-steps/${step!.id}/actions/approve`, {
    headers: { ...(await csrfHeaders(ctx)), 'content-type': 'application/json' },
    data: {},
  });
  expect(res.ok(), `approve ${res.status()}`).toBeTruthy();
  return json<RouteDto[]>(res);
}

test('docflow routes: a two-step approval route advances and completes', async () => {
  const admin = await request.newContext({ storageState: STORAGE_STATE, baseURL: API });
  const headers = { ...(await csrfHeaders(admin)), 'content-type': 'application/json' };

  const users = (
    await json<{ items: UserRow[] }>(await admin.get('/api/v1/admin/users?page=1&limit=100'))
  ).items;
  const u1 = users.find((u) => u.username === E2E_USER.username)!;
  const u2 = users.find((u) => u.username === E2E_USER2.username)!;
  expect(u1 && u2, 'the two approver fixtures exist').toBeTruthy();

  const docId = await createDraft(admin, headers);
  const start = await admin.post(`/api/v1/docflow/documents/${docId}/route`, {
    headers,
    data: {
      steps: [
        { order: 1, kind: 'approve', assigneeType: 'user', assigneeId: u1.id },
        { order: 2, kind: 'approve', assigneeType: 'user', assigneeId: u2.id },
      ],
    },
  });
  expect(start.ok(), `start route ${start.status()}`).toBeTruthy();
  expect(
    (await json<DocumentDto>(await admin.get(`/api/v1/docflow/documents/${docId}`))).status,
  ).toBe('on_route');

  // Approver 1 acts; the route advances to the second step, the document stays on_route.
  const approver1 = await apiLogin(E2E_USER.username, E2E_USER.password);
  await approve(approver1, docId);
  expect(
    (await json<DocumentDto>(await admin.get(`/api/v1/docflow/documents/${docId}`))).status,
  ).toBe('on_route');

  // Approver 2 acts; the route completes and the document awaits registration.
  const approver2 = await apiLogin(E2E_USER2.username, E2E_USER2.password);
  const finalRoutes = await approve(approver2, docId);
  expect(finalRoutes[0]?.status).toBe('completed');
  expect(
    (await json<DocumentDto>(await admin.get(`/api/v1/docflow/documents/${docId}`))).status,
  ).toBe('pending_registration');

  await Promise.all([admin.dispose(), approver1.dispose(), approver2.dispose()]);
});

test('docflow routes: a rejection returns the document to the author as a draft', async () => {
  const admin = await request.newContext({ storageState: STORAGE_STATE, baseURL: API });
  const headers = { ...(await csrfHeaders(admin)), 'content-type': 'application/json' };
  const users = (
    await json<{ items: UserRow[] }>(await admin.get('/api/v1/admin/users?page=1&limit=100'))
  ).items;
  const u1 = users.find((u) => u.username === E2E_USER.username)!;

  const docId = await createDraft(admin, headers);
  await admin.post(`/api/v1/docflow/documents/${docId}/route`, {
    headers,
    data: { steps: [{ order: 1, kind: 'approve', assigneeType: 'user', assigneeId: u1.id }] },
  });

  const approver = await apiLogin(E2E_USER.username, E2E_USER.password);
  const routes = await json<RouteDto[]>(
    await approver.get(`/api/v1/docflow/documents/${docId}/routes`),
  );
  const step = routes[0]!.steps.find((s) => s.canAct)!;
  // Rejection requires a reason.
  const noReason = await approver.post(`/api/v1/docflow/route-steps/${step.id}/actions/reject`, {
    headers: { ...(await csrfHeaders(approver)), 'content-type': 'application/json' },
    data: {},
  });
  expect(noReason.status(), 'a reason is required to reject').toBe(400);

  const rejected = await approver.post(`/api/v1/docflow/route-steps/${step.id}/actions/reject`, {
    headers: { ...(await csrfHeaders(approver)), 'content-type': 'application/json' },
    data: { comment: 'Нужны правки' },
  });
  expect(rejected.ok(), `reject ${rejected.status()}`).toBeTruthy();
  expect((await json<RouteDto[]>(rejected))[0]?.status).toBe('cancelled');
  expect(
    (await json<DocumentDto>(await admin.get(`/api/v1/docflow/documents/${docId}`))).status,
  ).toBe('draft');

  await Promise.all([admin.dispose(), approver.dispose()]);
});
