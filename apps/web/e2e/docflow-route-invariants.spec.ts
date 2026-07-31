import { expect, request, test, type APIRequestContext } from '@playwright/test';
import { csrfHeaders } from './support/api';
import { STORAGE_STATE } from './support/fixtures';

/**
 * Route and status invariants (docs/modules/11 §4, plan этап 1D). Drives the real engine
 * over the API + PostgreSQL: a step nobody can act on is refused before the route exists;
 * each step kind is closed only by the action carrying its guarantee; registering closes
 * the `register` step; and a document cannot declare itself finished while it still owes
 * an active route step.
 */
const API = 'http://localhost:3000';

interface DocumentDto {
  id: string;
  status: string;
  regNumber: string | null;
}
interface RouteStepDto {
  id: string;
  stepOrder: number;
  kind: string;
  status: string;
  canAct: boolean;
}
interface RouteDto {
  status: string;
  steps: RouteStepDto[];
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
async function adminId(ctx: APIRequestContext): Promise<string> {
  const me = await json<{ id: string }>(await ctx.get('/api/v1/auth/me'));
  return me.id;
}
async function createDraft(
  ctx: APIRequestContext,
  headers: Record<string, string>,
  subject: string,
): Promise<string> {
  const res = await ctx.post('/api/v1/docflow/documents', {
    headers,
    data: { docClass: 'internal', typeCode: 'order', subject },
  });
  expect(res.ok(), `create ${res.status()}`).toBeTruthy();
  return (await json<DocumentDto>(res)).id;
}
async function routesOf(ctx: APIRequestContext, documentId: string): Promise<RouteDto[]> {
  return json<RouteDto[]>(await ctx.get(`/api/v1/docflow/documents/${documentId}/routes`));
}

test('routes: a step nobody can act on is refused, and no route is created', async () => {
  const admin = await request.newContext({ storageState: STORAGE_STATE, baseURL: API });
  const headers = await jsonHeaders(admin);

  // A brand-new subdivision has no members, so an org-unit step resolves to nobody.
  const unit = await json<{ id: string }>(
    await admin.post('/api/v1/admin/org-units', {
      headers,
      data: { name: `Пустой отдел ${Date.now()}`, type: 'division' },
    }),
  );
  const documentId = await createDraft(admin, headers, `Тупиковый маршрут ${Date.now()}`);

  const res = await admin.post(`/api/v1/docflow/documents/${documentId}/route`, {
    headers,
    data: { steps: [{ order: 1, kind: 'approve', assigneeType: 'org_unit', assigneeId: unit.id }] },
  });
  expect(res.status(), 'a step with no resolvable actor is rejected').toBe(422);
  expect((await json<ErrorBody>(res)).error?.code).toBe('docflow.route.step_has_no_assignee');

  // The whole start is one transaction: nothing was written, and the document is still a draft.
  expect(await routesOf(admin, documentId)).toEqual([]);
  const doc = await json<DocumentDto>(await admin.get(`/api/v1/docflow/documents/${documentId}`));
  expect(doc.status).toBe('draft');

  await admin.dispose();
});

test('routes: each kind is closed only by the action that carries its guarantee', async () => {
  const admin = await request.newContext({ storageState: STORAGE_STATE, baseURL: API });
  const headers = await jsonHeaders(admin);
  const me = await adminId(admin);
  const documentId = await createDraft(admin, headers, `Инварианты шагов ${Date.now()}`);

  await admin.post(`/api/v1/docflow/documents/${documentId}/route`, {
    headers,
    data: {
      steps: [
        { order: 1, kind: 'approve', assigneeType: 'user', assigneeId: me },
        { order: 2, kind: 'sign', assigneeType: 'user', assigneeId: me },
      ],
    },
  });
  const active = (await routesOf(admin, documentId))[0]!.steps;
  const approveStep = active.find((s) => s.kind === 'approve')!;
  const signStep = active.find((s) => s.kind === 'sign')!;

  // `complete` belongs to an execute step — it must not close an approval.
  const wrongOnApprove = await admin.post(
    `/api/v1/docflow/route-steps/${approveStep.id}/actions/complete`,
    { headers, data: {} },
  );
  expect(wrongOnApprove.status()).toBe(409);
  expect((await json<ErrorBody>(wrongOnApprove)).error?.code).toBe(
    'docflow.route_step.action_kind_mismatch',
  );

  // Advance to the sign step, then try to approve it — the signature is its guarantee.
  const ok = await admin.post(`/api/v1/docflow/route-steps/${approveStep.id}/actions/approve`, {
    headers,
    data: {},
  });
  expect(ok.ok(), `approve ${ok.status()}`).toBeTruthy();
  const approveOnSign = await admin.post(
    `/api/v1/docflow/route-steps/${signStep.id}/actions/approve`,
    { headers, data: {} },
  );
  expect(approveOnSign.status()).toBe(409);
  expect((await json<ErrorBody>(approveOnSign)).error?.code).toBe(
    'docflow.route_step.action_kind_mismatch',
  );

  await admin.dispose();
});

test('routes: an execute step is closed by complete, and registering closes a register step', async () => {
  const admin = await request.newContext({ storageState: STORAGE_STATE, baseURL: API });
  const headers = await jsonHeaders(admin);
  const me = await adminId(admin);
  const documentId = await createDraft(admin, headers, `Исполнение и регистрация ${Date.now()}`);

  await admin.post(`/api/v1/docflow/documents/${documentId}/route`, {
    headers,
    data: {
      steps: [
        { order: 1, kind: 'execute', assigneeType: 'user', assigneeId: me },
        { order: 2, kind: 'register', assigneeType: 'user', assigneeId: me },
      ],
    },
  });
  const executeStep = (await routesOf(admin, documentId))[0]!.steps.find(
    (s) => s.kind === 'execute',
  )!;
  const done = await admin.post(`/api/v1/docflow/route-steps/${executeStep.id}/actions/complete`, {
    headers,
    data: { comment: 'Исполнено' },
  });
  expect(done.ok(), `complete ${done.status()}`).toBeTruthy();

  const afterExecute = (await routesOf(admin, documentId))[0]!.steps;
  expect(afterExecute.find((s) => s.kind === 'execute')!.status).toBe('done');
  expect(afterExecute.find((s) => s.kind === 'register')!.status).toBe('active');

  // Registration is the register step's completion path — the number is its guarantee.
  const journals = await json<{ id: string; code: string }[]>(
    await admin.get('/api/v1/docflow/journals'),
  );
  const orders = journals.find((j) => j.code === 'orders')!;
  const registered = await admin.post(`/api/v1/docflow/documents/${documentId}/actions/register`, {
    headers,
    data: { journalId: orders.id },
  });
  expect(registered.ok(), `register ${registered.status()}`).toBeTruthy();
  const card = await json<DocumentDto>(registered);
  expect(card.status).toBe('registered');
  expect(card.regNumber).toMatch(/^П-\d{4}\/\d{4}$/);

  const afterRegister = (await routesOf(admin, documentId))[0]!;
  expect(afterRegister.steps.find((s) => s.kind === 'register')!.status).toBe('done');
  expect(afterRegister.status, 'the last group closed, so the route is complete').toBe('completed');

  await admin.dispose();
});

test('routes: a registered document cannot be closed while a route step is still open', async () => {
  const admin = await request.newContext({ storageState: STORAGE_STATE, baseURL: API });
  const headers = await jsonHeaders(admin);
  const me = await adminId(admin);
  const documentId = await createDraft(admin, headers, `Открытые обязательства ${Date.now()}`);

  // Registering FIRST leaves the document `registered` with the rest of the route still
  // running — the exact shape where the transition graph alone would let it be archived.
  await admin.post(`/api/v1/docflow/documents/${documentId}/route`, {
    headers,
    data: {
      steps: [
        { order: 1, kind: 'register', assigneeType: 'user', assigneeId: me },
        { order: 2, kind: 'approve', assigneeType: 'user', assigneeId: me },
      ],
    },
  });
  const journals = await json<{ id: string; code: string }[]>(
    await admin.get('/api/v1/docflow/journals'),
  );
  const orders = journals.find((j) => j.code === 'orders')!;
  const registered = await admin.post(`/api/v1/docflow/documents/${documentId}/actions/register`, {
    headers,
    data: { journalId: orders.id },
  });
  expect(registered.ok(), `register ${registered.status()}`).toBeTruthy();
  expect((await json<DocumentDto>(registered)).status).toBe('registered');
  const stillOpen = (await routesOf(admin, documentId))[0]!.steps.find(
    (s) => s.kind === 'approve',
  )!;
  expect(stillOpen.status, 'the approval group activated after registration').toBe('active');

  // `registered → archived` IS in the transition graph — only the obligation gate stops it.
  const archive = await admin.post(`/api/v1/docflow/documents/${documentId}/actions/status`, {
    headers,
    data: { status: 'archived' },
  });
  expect(archive.status(), 'an open route step blocks the close').toBe(422);
  expect((await json<ErrorBody>(archive)).error?.code).toBe('docflow.document.route_open');

  const doc = await json<DocumentDto>(await admin.get(`/api/v1/docflow/documents/${documentId}`));
  expect(doc.status, 'and the document keeps its real status').toBe('registered');

  // Once the step is closed the very same transition succeeds.
  const approved = await admin.post(`/api/v1/docflow/route-steps/${stillOpen.id}/actions/approve`, {
    headers,
    data: {},
  });
  expect(approved.ok(), `approve ${approved.status()}`).toBeTruthy();
  const reArchive = await admin.post(`/api/v1/docflow/documents/${documentId}/actions/status`, {
    headers,
    data: { status: 'archived' },
  });
  expect(reArchive.ok(), `archive ${reArchive.status()}`).toBeTruthy();

  await admin.dispose();
});
