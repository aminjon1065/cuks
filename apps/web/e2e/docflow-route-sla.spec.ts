import { expect, request, test, type APIRequestContext } from '@playwright/test';
import { csrfHeaders } from './support/api';
import { STORAGE_STATE } from './support/fixtures';

/**
 * Route SLA and dry-run validation (docs/modules/11 §12.9, plan этап 4). Drives the real
 * API + PostgreSQL: activating a step starts its clock, the next group's clock starts only
 * when the barrier lifts, and the dry-run reports who each step would reach — including the
 * ones that would reach nobody — without writing anything.
 */
const API = 'http://localhost:3000';

interface RouteStepDto {
  id: string;
  stepOrder: number;
  kind: string;
  status: string;
  dueHours: number | null;
  activatedAt: string | null;
  dueAt: string | null;
  completedAt: string | null;
}
interface RouteDto {
  status: string;
  steps: RouteStepDto[];
}
interface ValidationDto {
  valid: boolean;
  steps: { order: number; assigneeName: string | null; actorNames: string[]; problems: string[] }[];
  groups: { order: number; stepCount: number }[];
}

async function json<T>(res: { json: () => Promise<unknown> }): Promise<T> {
  return (await res.json()) as T;
}
async function jsonHeaders(ctx: APIRequestContext): Promise<Record<string, string>> {
  return { ...(await csrfHeaders(ctx)), 'content-type': 'application/json' };
}
async function meId(ctx: APIRequestContext): Promise<string> {
  const res = await ctx.get('/api/auth/me');
  expect(res.ok(), `auth/me ${res.status()}`).toBeTruthy();
  return (await json<{ id: string }>(res)).id;
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
  return (await json<{ id: string }>(res)).id;
}
async function routesOf(ctx: APIRequestContext, documentId: string): Promise<RouteDto[]> {
  return json<RouteDto[]>(await ctx.get(`/api/v1/docflow/documents/${documentId}/routes`));
}

test('route sla: activation starts the clock, and only for the active group', async () => {
  const admin = await request.newContext({ storageState: STORAGE_STATE, baseURL: API });
  const headers = await jsonHeaders(admin);
  const me = await meId(admin);
  const documentId = await createDraft(admin, headers, `SLA маршрута ${Date.now()}`);

  const started = await admin.post(`/api/v1/docflow/documents/${documentId}/route`, {
    headers,
    data: {
      steps: [
        { order: 1, kind: 'approve', assigneeType: 'user', assigneeId: me, dueHours: 4 },
        { order: 2, kind: 'approve', assigneeType: 'user', assigneeId: me, dueHours: 24 },
      ],
    },
  });
  expect(started.ok(), `start ${started.status()} ${await started.text()}`).toBeTruthy();

  const first = (await routesOf(admin, documentId))[0]!.steps;
  const s1 = first.find((s) => s.stepOrder === 1)!;
  const s2 = first.find((s) => s.stepOrder === 2)!;

  expect(s1.status).toBe('active');
  expect(s1.activatedAt, 'the active step has a start moment').toBeTruthy();
  expect(s1.dueAt, 'and a deadline').toBeTruthy();
  // 4 hours after activation, to the minute.
  const elapsed = new Date(s1.dueAt!).getTime() - new Date(s1.activatedAt!).getTime();
  expect(elapsed).toBe(4 * 60 * 60 * 1000);

  // The waiting step has no clock yet: its SLA must run from ITS activation, not the
  // route's start, or a long first step would eat the second step's whole budget.
  expect(s2.status).toBe('pending');
  expect(s2.activatedAt).toBeNull();
  expect(s2.dueAt).toBeNull();

  const approved = await admin.post(`/api/v1/docflow/route-steps/${s1.id}/actions/approve`, {
    headers,
    data: {},
  });
  expect(approved.ok(), `approve ${approved.status()}`).toBeTruthy();

  const after = (await routesOf(admin, documentId))[0]!.steps;
  const done = after.find((s) => s.stepOrder === 1)!;
  const active = after.find((s) => s.stepOrder === 2)!;
  expect(done.completedAt, 'a closed step records when it closed').toBeTruthy();
  expect(active.status).toBe('active');
  expect(active.activatedAt, 'the next group starts its own clock now').toBeTruthy();
  expect(new Date(active.dueAt!).getTime() - new Date(active.activatedAt!).getTime()).toBe(
    24 * 60 * 60 * 1000,
  );

  await admin.dispose();
});

test('route sla: a step with no SLA never gets a deadline', async () => {
  const admin = await request.newContext({ storageState: STORAGE_STATE, baseURL: API });
  const headers = await jsonHeaders(admin);
  const me = await meId(admin);
  const documentId = await createDraft(admin, headers, `Без срока ${Date.now()}`);

  await admin.post(`/api/v1/docflow/documents/${documentId}/route`, {
    headers,
    data: { steps: [{ order: 1, kind: 'approve', assigneeType: 'user', assigneeId: me }] },
  });
  const step = (await routesOf(admin, documentId))[0]!.steps[0]!;
  expect(step.status).toBe('active');
  expect(step.activatedAt).toBeTruthy();
  // «When you get to it» is a legitimate step; inventing a deadline would fill the
  // overdue sweep with noise nobody asked for.
  expect(step.dueAt).toBeNull();

  await admin.dispose();
});

test('route validate: the dry-run maps the route and writes nothing', async () => {
  const admin = await request.newContext({ storageState: STORAGE_STATE, baseURL: API });
  const headers = await jsonHeaders(admin);
  const me = await meId(admin);
  const documentId = await createDraft(admin, headers, `Проверка маршрута ${Date.now()}`);

  const emptyUnit = await json<{ id: string }>(
    await admin.post('/api/v1/admin/org-units', {
      headers,
      data: { name: `Пустой для проверки ${Date.now()}`, type: 'division' },
    }),
  );

  const res = await admin.post(`/api/v1/docflow/documents/${documentId}/route/validate`, {
    headers,
    data: {
      steps: [
        { order: 1, kind: 'approve', assigneeType: 'user', assigneeId: me },
        { order: 1, kind: 'approve', assigneeType: 'org_unit', assigneeId: emptyUnit.id },
        { order: 2, kind: 'sign', assigneeType: 'user', assigneeId: me },
      ],
    },
  });
  expect(res.ok(), `validate ${res.status()}`).toBeTruthy();
  const verdict = await json<ValidationDto>(res);

  expect(verdict.valid, 'a step that reaches nobody makes the whole route unstartable').toBe(false);
  expect(verdict.groups).toEqual([
    { order: 1, stepCount: 2 },
    { order: 2, stepCount: 1 },
  ]);
  const [ok, broken] = verdict.steps;
  expect(ok!.problems).toEqual([]);
  expect(ok!.actorNames.length, 'a user step resolves to exactly that user').toBe(1);
  expect(broken!.problems, 'and the empty subdivision is named as the problem').toContain(
    'no_assignee',
  );
  expect(broken!.assigneeName, 'while still showing which subdivision it was').toBeTruthy();

  // Nothing was written: the document is still an un-routed draft.
  expect(await routesOf(admin, documentId)).toEqual([]);
  const doc = await json<{ status: string }>(
    await admin.get(`/api/v1/docflow/documents/${documentId}`),
  );
  expect(doc.status).toBe('draft');

  await admin.dispose();
});
