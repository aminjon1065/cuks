import { expect, request, test, type APIRequestContext } from '@playwright/test';
import { apiLogin, csrfHeaders } from './support/api';
import { E2E_USER, STORAGE_STATE } from './support/fixtures';

/**
 * Phase-3 acceptance criteria (docs/modules/11 §10) that were not yet covered end-to-end:
 * concurrent registration mints a gap-free unique sequence; the full incoming cycle runs to «в
 * дело»; and relaunching a rejected route keeps the first cycle's history. The outgoing cycle +
 * file-swap-breaks-signature (docflow-signatures) and substitution «за» (docflow-substitutions)
 * are covered in their own specs.
 */
const API = 'http://localhost:3000';

interface DocumentDto {
  id: string;
  status: string;
  regNumber: string | null;
}
interface ResolutionDto {
  id: string;
  status: string;
}
interface RouteStepDto {
  id: string;
  kind: string;
  status: string;
  decision: string | null;
  comment: string | null;
  canAct: boolean;
}
interface RouteDto {
  cycle: number;
  status: string;
  steps: RouteStepDto[];
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
async function createDraft(
  admin: APIRequestContext,
  headers: Record<string, string>,
): Promise<string> {
  const doc = await json<DocumentDto>(
    await admin.post('/api/v1/docflow/documents', {
      headers,
      data: {
        docClass: 'incoming',
        typeCode: 'letter',
        subject: `Acc ${Date.now()}-${Math.random()}`,
      },
    }),
  );
  return doc.id;
}

test('acceptance: 50 concurrent registrations mint a unique, gap-free sequence', async () => {
  const admin = await request.newContext({ storageState: STORAGE_STATE, baseURL: API });
  const headers = await jsonHeaders(admin);

  // A fresh journal so its counter starts at 1 regardless of prior runs; the number IS the seq.
  const journal = await json<{ id: string }>(
    await admin.post('/api/v1/docflow/journals', {
      headers,
      data: {
        code: `conc-${Date.now()}`,
        name: 'Конкурентная нумерация',
        docClass: 'incoming',
        numberTemplate: '{seq4}',
        seqReset: 'never',
      },
    }),
  );

  const N = 50;
  const docIds = await Promise.all(Array.from({ length: N }, () => createDraft(admin, headers)));

  // Register all N at once — the atomic counter upsert must serialize without dups or gaps.
  const registered = await Promise.all(
    docIds.map((id) =>
      admin.post(`/api/v1/docflow/documents/${id}/actions/register`, {
        headers,
        data: { journalId: journal.id },
      }),
    ),
  );
  expect(
    registered.every((r) => r.ok()),
    'every registration succeeded',
  ).toBe(true);

  const numbers = await Promise.all(
    registered.map((r) => json<DocumentDto>(r).then((d) => d.regNumber!)),
  );
  const seqs = numbers.map((n) => Number(n)).sort((a, b) => a - b);
  expect(new Set(numbers).size, 'all registration numbers are unique').toBe(N);
  expect(seqs, 'the sequence is 1..N with no gaps').toEqual(
    Array.from({ length: N }, (_, i) => i + 1),
  );

  await admin.dispose();
});

test('acceptance: the full incoming cycle runs register → resolution → execution → «в дело»', async () => {
  const admin = await request.newContext({ storageState: STORAGE_STATE, baseURL: API });
  const headers = await jsonHeaders(admin);
  const executorId = (await userIds(admin))[E2E_USER.username];

  // Register an incoming document.
  const docId = await createDraft(admin, headers);
  const journals = await json<{ id: string; code: string }[]>(
    await admin.get('/api/v1/docflow/journals'),
  );
  const journalId = journals.find((j) => j.code === 'incoming')!.id;
  const reg = await json<DocumentDto>(
    await admin.post(`/api/v1/docflow/documents/${docId}/actions/register`, {
      headers,
      data: { journalId },
    }),
  );
  expect(reg.status).toBe('registered');
  expect(reg.regNumber, 'a number was minted').toBeTruthy();

  // A controlled resolution moves it into execution.
  await admin.post(`/api/v1/docflow/documents/${docId}/resolutions`, {
    headers,
    data: {
      text: 'Исполнить входящее',
      executorId,
      isControl: true,
      dueDate: '2026-08-01T00:00:00.000Z',
    },
  });
  expect(
    (await json<DocumentDto>(await admin.get(`/api/v1/docflow/documents/${docId}`))).status,
  ).toBe('in_progress');

  // The executor reports and completes their task.
  const executor = await apiLogin(E2E_USER.username, E2E_USER.password);
  const res = (
    await json<ResolutionDto[]>(
      await executor.get(`/api/v1/docflow/documents/${docId}/resolutions`),
    )
  )[0]!;
  await executor.post(`/api/v1/docflow/resolutions/${res.id}/actions/report`, {
    headers: await jsonHeaders(executor),
    data: { report: 'Исполнено' },
  });
  const done = await json<ResolutionDto[]>(
    await executor.post(`/api/v1/docflow/resolutions/${res.id}/actions/done`, {
      headers: await jsonHeaders(executor),
      data: {},
    }),
  );
  expect(done[0]!.status).toBe('done');

  // The chancellery completes the document and files it «в дело» (archived).
  const status = async (target: string) =>
    admin.post(`/api/v1/docflow/documents/${docId}/actions/status`, {
      headers,
      data: { status: target },
    });
  expect((await status('completed')).ok(), 'registered→...→completed').toBeTruthy();
  expect((await status('archived')).ok(), 'completed→archived').toBeTruthy();
  expect(
    (await json<DocumentDto>(await admin.get(`/api/v1/docflow/documents/${docId}`))).status,
  ).toBe('archived');

  await Promise.all([admin.dispose(), executor.dispose()]);
});

test('acceptance: relaunching a rejected route keeps the first cycle in the history', async () => {
  const admin = await request.newContext({ storageState: STORAGE_STATE, baseURL: API });
  const headers = await jsonHeaders(admin);
  const approverId = (await userIds(admin))[E2E_USER.username];
  const docId = await createDraft(admin, headers);

  const route = (steps: unknown) =>
    admin.post(`/api/v1/docflow/documents/${docId}/route`, { headers, data: { steps } });
  const approveStep = [{ order: 1, kind: 'approve', assigneeType: 'user', assigneeId: approverId }];

  // Cycle 1: send on route, then the approver rejects it with a comment (back to draft).
  await route(approveStep);
  const approver = await apiLogin(E2E_USER.username, E2E_USER.password);
  const step1 = (
    await json<RouteDto[]>(await approver.get(`/api/v1/docflow/documents/${docId}/routes`))
  )[0]!.steps.find((s) => s.canAct)!;
  const rejected = await approver.post(`/api/v1/docflow/route-steps/${step1.id}/actions/reject`, {
    headers: await jsonHeaders(approver),
    data: { comment: 'Доработать преамбулу' },
  });
  expect(rejected.ok(), `reject ${rejected.status()}`).toBeTruthy();
  expect(
    (await json<DocumentDto>(await admin.get(`/api/v1/docflow/documents/${docId}`))).status,
  ).toBe('draft');

  // Cycle 2: relaunch the route — a NEW cycle, the first kept as history.
  await route(approveStep);
  const routes = await json<RouteDto[]>(
    await admin.get(`/api/v1/docflow/documents/${docId}/routes`),
  );
  expect(routes.length, 'both cycles are present').toBeGreaterThanOrEqual(2);
  const cycle1 = routes.find((r) => r.cycle === 1)!;
  const cycle2 = routes.find((r) => r.cycle === 2)!;
  expect(cycle1.status, 'the first cycle is cancelled').toBe('cancelled');
  expect(
    cycle1.steps.some((s) => s.decision === 'rejected' && s.comment === 'Доработать преамбулу'),
  ).toBe(true);
  expect(cycle2.status, 'the new cycle is active').toBe('active');

  await Promise.all([admin.dispose(), approver.dispose()]);
});
