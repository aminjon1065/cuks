import { expect, request, test, type APIRequestContext } from '@playwright/test';
import { apiLogin, csrfHeaders } from './support/api';
import { E2E_USER, E2E_USER2, STORAGE_STATE } from './support/fixtures';

/**
 * Resolutions (docs/modules/11 §3/§5, task 3.4). Drives the real flow over the API +
 * PostgreSQL: a leader issues a controlled resolution (moving the document to
 * in_progress), the executor sees it in «Мои поручения», reports and completes it, the
 * author extends its deadline, and a sub-resolution delegates onward — while a
 * non-participant cannot see the document.
 */
const API = 'http://localhost:3000';

interface DocumentDto {
  id: string;
  status: string;
}
interface ExtensionDto {
  reason: string;
  newDue: string;
}
interface ResolutionDto {
  id: string;
  status: string;
  report: string | null;
  canReport: boolean;
  canManage: boolean;
  executorId: string;
  extensions: ExtensionDto[];
  children: ResolutionDto[];
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

/** Create + register a document (as the admin author), returning its id. */
async function registeredDoc(
  admin: APIRequestContext,
  headers: Record<string, string>,
): Promise<string> {
  const draft = await json<DocumentDto>(
    await admin.post('/api/v1/docflow/documents', {
      headers,
      data: { docClass: 'incoming', typeCode: 'letter', subject: `Resolution ${Date.now()}` },
    }),
  );
  const journals = await json<{ id: string; code: string }[]>(
    await admin.get('/api/v1/docflow/journals'),
  );
  const journalId = journals.find((j) => j.code === 'incoming')!.id;
  const reg = await admin.post(`/api/v1/docflow/documents/${draft.id}/actions/register`, {
    headers,
    data: { journalId },
  });
  expect(reg.ok(), `register ${reg.status()}`).toBeTruthy();
  return draft.id;
}

async function users(admin: APIRequestContext): Promise<Record<string, string>> {
  const rows = (
    await json<{ items: UserRow[] }>(await admin.get('/api/v1/admin/users?page=1&limit=100'))
  ).items;
  return Object.fromEntries(rows.map((u) => [u.username, u.id]));
}

test('resolutions: issue → report → extend → complete, moving the document through execution', async () => {
  const admin = await request.newContext({ storageState: STORAGE_STATE, baseURL: API });
  const headers = await jsonHeaders(admin);
  const byName = await users(admin);
  const docId = await registeredDoc(admin, headers);

  // The leader issues a controlled resolution to e2e_user — execution begins.
  const issued = await admin.post(`/api/v1/docflow/documents/${docId}/resolutions`, {
    headers,
    data: {
      text: 'Подготовить ответ',
      executorId: byName[E2E_USER.username],
      isControl: true,
      dueDate: '2026-08-01T00:00:00.000Z',
    },
  });
  expect(issued.ok(), `issue ${issued.status()}`).toBeTruthy();
  expect(
    (await json<DocumentDto>(await admin.get(`/api/v1/docflow/documents/${docId}`))).status,
  ).toBe('in_progress');

  // The executor finds it in «Мои поручения» and reports.
  const executor = await apiLogin(E2E_USER.username, E2E_USER.password);
  const queue = await json<{ items: DocumentDto[] }>(
    await executor.get('/api/v1/docflow/documents?queue=my_tasks&page=1&limit=50'),
  );
  expect(
    queue.items.some((d) => d.id === docId),
    'the task appears in my_tasks',
  ).toBeTruthy();

  const before = await json<ResolutionDto[]>(
    await executor.get(`/api/v1/docflow/documents/${docId}/resolutions`),
  );
  const res = before[0]!;
  expect(res.canReport).toBe(true);
  const reported = await executor.post(`/api/v1/docflow/resolutions/${res.id}/actions/report`, {
    headers: await jsonHeaders(executor),
    data: { report: 'Ответ подготовлен' },
  });
  expect(reported.ok(), `report ${reported.status()}`).toBeTruthy();

  // The author (leader) extends the deadline with a reason.
  const extended = await json<ResolutionDto[]>(
    await admin.post(`/api/v1/docflow/resolutions/${res.id}/actions/extend`, {
      headers,
      data: { newDue: '2026-08-15T00:00:00.000Z', reason: 'Дополнительное согласование' },
    }),
  );
  expect(extended[0]?.extensions.at(-1)?.reason).toBe('Дополнительное согласование');

  // The executor marks it done.
  const done = await json<ResolutionDto[]>(
    await executor.post(`/api/v1/docflow/resolutions/${res.id}/actions/done`, {
      headers: await jsonHeaders(executor),
      data: {},
    }),
  );
  expect(done[0]?.status).toBe('done');
  expect(done[0]?.report).toBe('Ответ подготовлен');

  await Promise.all([admin.dispose(), executor.dispose()]);
});

test('resolutions: a sub-resolution delegates onward, and a non-participant cannot see the document', async () => {
  const admin = await request.newContext({ storageState: STORAGE_STATE, baseURL: API });
  const headers = await jsonHeaders(admin);
  const byName = await users(admin);
  const docId = await registeredDoc(admin, headers);

  await admin.post(`/api/v1/docflow/documents/${docId}/resolutions`, {
    headers,
    data: { text: 'Исполнить', executorId: byName[E2E_USER.username] },
  });

  // Before delegation, e2e_user2 is not a participant → 404 (existence never leaks).
  const outsider = await apiLogin(E2E_USER2.username, E2E_USER2.password);
  expect((await outsider.get(`/api/v1/docflow/documents/${docId}`)).status()).toBe(404);

  // The executor delegates a sub-resolution to e2e_user2.
  const executor = await apiLogin(E2E_USER.username, E2E_USER.password);
  const res = (
    await json<ResolutionDto[]>(
      await executor.get(`/api/v1/docflow/documents/${docId}/resolutions`),
    )
  )[0]!;
  const sub = await executor.post(`/api/v1/docflow/resolutions/${res.id}/subresolutions`, {
    headers: await jsonHeaders(executor),
    data: { text: 'Собрать данные', executorId: byName[E2E_USER2.username] },
  });
  expect(sub.ok(), `sub ${sub.status()}`).toBeTruthy();
  const tree = await json<ResolutionDto[]>(sub);
  expect(tree[0]?.children.length, 'the sub-resolution nests under its parent').toBe(1);

  // Now e2e_user2 is a resolution participant → can view the document and its task.
  expect((await outsider.get(`/api/v1/docflow/documents/${docId}`)).ok()).toBeTruthy();
  const queue = await json<{ items: DocumentDto[] }>(
    await outsider.get('/api/v1/docflow/documents?queue=my_tasks&page=1&limit=50'),
  );
  expect(queue.items.some((d) => d.id === docId)).toBeTruthy();

  await Promise.all([admin.dispose(), executor.dispose(), outsider.dispose()]);
});
