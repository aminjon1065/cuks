import { expect, request, test, type APIRequestContext } from '@playwright/test';
import { apiLogin, csrfHeaders } from './support/api';
import { E2E_USER, STORAGE_STATE } from './support/fixtures';

/**
 * Execution control (docs/modules/11 §5, task 3.8). Drives the real flow over the API +
 * PostgreSQL: a controlled resolution appears on «На контроле» with a deadline severity;
 * it is extended and then removed from control (kept active); the control view is gated by
 * docflow.control.
 */
const API = 'http://localhost:3000';

interface DocumentDto {
  id: string;
}
interface ResolutionDto {
  id: string;
  isControl: boolean;
  status: string;
}
interface ControlItemDto {
  kind: string;
  id: string;
  documentId: string;
  severity: string;
  dueDate: string | null;
}

async function json<T>(res: { json: () => Promise<unknown> }): Promise<T> {
  return (await res.json()) as T;
}
async function jsonHeaders(ctx: APIRequestContext): Promise<Record<string, string>> {
  return { ...(await csrfHeaders(ctx)), 'content-type': 'application/json' };
}
async function users(admin: APIRequestContext): Promise<Record<string, string>> {
  const rows = (
    await json<{ items: { id: string; username: string }[] }>(
      await admin.get('/api/v1/admin/users?page=1&limit=100'),
    )
  ).items;
  return Object.fromEntries(rows.map((u) => [u.username, u.id]));
}
async function registeredDoc(
  admin: APIRequestContext,
  headers: Record<string, string>,
): Promise<string> {
  const draft = await json<DocumentDto>(
    await admin.post('/api/v1/docflow/documents', {
      headers,
      data: { docClass: 'incoming', typeCode: 'letter', subject: `Control ${Date.now()}` },
    }),
  );
  const journals = await json<{ id: string; code: string }[]>(
    await admin.get('/api/v1/docflow/journals'),
  );
  const journalId = journals.find((j) => j.code === 'incoming')!.id;
  await admin.post(`/api/v1/docflow/documents/${draft.id}/actions/register`, {
    headers,
    data: { journalId },
  });
  return draft.id;
}

test('control: a controlled resolution shows on «На контроле», extends and comes off control', async () => {
  const admin = await request.newContext({ storageState: STORAGE_STATE, baseURL: API });
  const headers = await jsonHeaders(admin);
  const executorId = (await users(admin))[E2E_USER.username];
  const docId = await registeredDoc(admin, headers);

  // Issue a controlled resolution with a near deadline (2 days out → warning).
  const soon = new Date(Date.now() + 2 * 86_400_000).toISOString();
  const issued = await json<ResolutionDto[]>(
    await admin.post(`/api/v1/docflow/documents/${docId}/resolutions`, {
      headers,
      data: { text: 'Под контролем', executorId, isControl: true, dueDate: soon },
    }),
  );
  const resolutionId = issued[0]!.id;

  // It appears on the control view with a warning severity.
  const control = await json<ControlItemDto[]>(await admin.get('/api/v1/docflow/control'));
  const item = control.find((c) => c.kind === 'resolution' && c.id === resolutionId);
  expect(item, 'the controlled resolution is on «На контроле»').toBeTruthy();
  expect(item!.severity).toBe('warning');

  // Extend the deadline (stays on control).
  const newDue = new Date(Date.now() + 10 * 86_400_000).toISOString();
  const extended = await admin.post(`/api/v1/docflow/resolutions/${resolutionId}/actions/extend`, {
    headers,
    data: { newDue, reason: 'Дополнительное согласование' },
  });
  expect(extended.ok(), `extend ${extended.status()}`).toBeTruthy();
  const afterExtend = await json<ControlItemDto[]>(await admin.get('/api/v1/docflow/control'));
  expect(afterExtend.find((c) => c.id === resolutionId)?.severity, 'now beyond 3 days').toBe(
    'normal',
  );

  // Remove from control (with reason) — the resolution stays active but leaves the view.
  const uncontrolled = await json<ResolutionDto[]>(
    await admin.post(`/api/v1/docflow/resolutions/${resolutionId}/actions/uncontrol`, {
      headers,
      data: { reason: 'Исполнение под личным контролем' },
    }),
  );
  expect(uncontrolled[0]!.isControl, 'no longer on control').toBe(false);
  expect(uncontrolled[0]!.status, 'still active').toBe('active');
  const afterUncontrol = await json<ControlItemDto[]>(await admin.get('/api/v1/docflow/control'));
  expect(
    afterUncontrol.some((c) => c.id === resolutionId),
    'gone from «На контроле»',
  ).toBe(false);

  await admin.dispose();
});

test('control: the «На контроле» view requires docflow.control', async () => {
  const user = await apiLogin(E2E_USER.username, E2E_USER.password);
  const res = await user.get('/api/v1/docflow/control');
  expect(res.status(), 'a plain employee is forbidden').toBe(403);
  await user.dispose();
});
