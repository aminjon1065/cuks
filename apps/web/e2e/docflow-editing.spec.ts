import { expect, request, test, type APIRequestContext } from '@playwright/test';
import { apiLogin, csrfHeaders } from './support/api';
import { E2E_USER, E2E_USER2, STORAGE_STATE } from './support/fixtures';

/**
 * Document editing, collaborators and the timeline (docs/modules/11 §12.5, plan этап 2).
 * Drives the real API + PostgreSQL: an assigned preparer edits a draft but cannot touch
 * access or registration; a stale save is refused instead of overwriting the other editor;
 * a registered document's requisites are frozen; and the timeline records what changed
 * without ever carrying the values.
 */
const API = 'http://localhost:3000';

interface DocumentDto {
  id: string;
  version: number;
  subject: string;
  status: string;
  availableActions: string[];
  collaborators: { id: string; userId: string; role: string }[];
}
interface TimelineEntry {
  action: string;
  meta: Record<string, string | number | boolean> | null;
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
async function userIds(admin: APIRequestContext): Promise<Record<string, string>> {
  const rows = (
    await json<{ items: { id: string; username: string }[] }>(
      await admin.get('/api/v1/admin/users?page=1&limit=100'),
    )
  ).items;
  return Object.fromEntries(rows.map((u) => [u.username, u.id]));
}
async function createDraft(
  ctx: APIRequestContext,
  headers: Record<string, string>,
  subject: string,
): Promise<DocumentDto> {
  const res = await ctx.post('/api/v1/docflow/documents', {
    headers,
    data: { docClass: 'incoming', typeCode: 'letter', subject },
  });
  expect(res.ok(), `create ${res.status()}`).toBeTruthy();
  return json<DocumentDto>(res);
}

test('editing: a preparer edits the draft but gets nothing else', async () => {
  const admin = await request.newContext({ storageState: STORAGE_STATE, baseURL: API });
  const ids = await userIds(admin);
  await admin.dispose();

  const author = await apiLogin(E2E_USER.username, E2E_USER.password);
  const headers = await jsonHeaders(author);
  const doc = await createDraft(author, headers, `Редактирование ${Date.now()}`);
  expect(doc.version, 'a fresh document starts at version 1').toBe(1);
  expect(doc.availableActions).toContain('manageCollaborators');

  const invited = await author.post(`/api/v1/docflow/documents/${doc.id}/collaborators`, {
    headers,
    data: { userId: ids[E2E_USER2.username], role: 'preparer' },
  });
  expect(invited.ok(), `invite ${invited.status()}`).toBeTruthy();

  // The preparer sees the card and may edit it — and ONLY edit it.
  const preparer = await apiLogin(E2E_USER2.username, E2E_USER2.password);
  const preparerHeaders = await jsonHeaders(preparer);
  const asPreparer = await json<DocumentDto>(
    await preparer.get(`/api/v1/docflow/documents/${doc.id}`),
  );
  expect(asPreparer.availableActions).toEqual(['edit']);

  const edited = await preparer.patch(`/api/v1/docflow/documents/${doc.id}`, {
    headers: preparerHeaders,
    data: { expectedVersion: asPreparer.version, subject: 'Подготовлено соисполнителем' },
  });
  expect(edited.ok(), `preparer edit ${edited.status()}`).toBeTruthy();
  expect((await json<DocumentDto>(edited)).version, 'an accepted edit bumps the version').toBe(2);

  // Access management and collaborator management stay with the author. The grif path
  // answers 404 rather than 403 by design (docs/09 §3 — the ДСП surface never confirms a
  // document's existence to someone who may not manage it); collaborator management, which
  // carries no ДСП signal and is reached only after the card is already visible, says 403.
  const grif = await preparer.patch(`/api/v1/docflow/documents/${doc.id}/access`, {
    headers: preparerHeaders,
    data: { confidentiality: 'dsp', accessList: [] },
  });
  expect(grif.status(), 'a preparer must not widen or set the grif').toBe(404);
  const invite = await preparer.post(`/api/v1/docflow/documents/${doc.id}/collaborators`, {
    headers: preparerHeaders,
    data: { userId: ids[E2E_USER.username], role: 'editor' },
  });
  expect(invite.status(), 'a preparer must not invite further collaborators').toBe(403);

  await preparer.dispose();
  await author.dispose();
});

test('editing: a stale save is refused instead of overwriting the other editor', async () => {
  const author = await request.newContext({ storageState: STORAGE_STATE, baseURL: API });
  const headers = await jsonHeaders(author);
  const doc = await createDraft(author, headers, `Конкурентная правка ${Date.now()}`);

  // Both editors loaded version 1; the first save wins.
  const first = await author.patch(`/api/v1/docflow/documents/${doc.id}`, {
    headers,
    data: { expectedVersion: 1, subject: 'Правка первого редактора' },
  });
  expect(first.ok(), `first save ${first.status()}`).toBeTruthy();

  const second = await author.patch(`/api/v1/docflow/documents/${doc.id}`, {
    headers,
    data: { expectedVersion: 1, subject: 'Правка второго редактора' },
  });
  expect(second.status(), 'the stale save is a conflict').toBe(409);
  expect((await json<ErrorBody>(second)).error?.code).toBe('docflow.document.version_conflict');

  const card = await json<DocumentDto>(await author.get(`/api/v1/docflow/documents/${doc.id}`));
  expect(card.subject, "the winner's text survived intact").toBe('Правка первого редактора');
  expect(card.version).toBe(2);

  await author.dispose();
});

test('editing: requisites freeze after registration, and the timeline names the changed fields', async () => {
  const admin = await request.newContext({ storageState: STORAGE_STATE, baseURL: API });
  const headers = await jsonHeaders(admin);
  const doc = await createDraft(admin, headers, `Заморозка ${Date.now()}`);

  await admin.patch(`/api/v1/docflow/documents/${doc.id}`, {
    headers,
    data: { expectedVersion: 1, senderName: 'МЧС РТ', summary: 'О паводке' },
  });

  const journals = await json<{ id: string; code: string }[]>(
    await admin.get('/api/v1/docflow/journals'),
  );
  const incoming = journals.find((j) => j.code === 'incoming')!;
  const registered = await admin.post(`/api/v1/docflow/documents/${doc.id}/actions/register`, {
    headers,
    data: { journalId: incoming.id },
  });
  expect(registered.ok(), `register ${registered.status()}`).toBeTruthy();
  expect((await json<DocumentDto>(registered)).availableActions).not.toContain('edit');

  const late = await admin.patch(`/api/v1/docflow/documents/${doc.id}`, {
    headers,
    data: { expectedVersion: 2, subject: 'Поздняя правка' },
  });
  expect(late.status(), 'a registered document is a record, not a draft').toBe(409);
  expect((await json<ErrorBody>(late)).error?.code).toBe('docflow.document.not_editable');

  // The timeline names WHICH fields an edit touched — never their values.
  const timeline = await json<TimelineEntry[]>(
    await admin.get(`/api/v1/docflow/documents/${doc.id}/timeline`),
  );
  const update = timeline.find((e) => e.action === 'docflow.document.updated');
  expect(update, 'the edit is on the timeline').toBeTruthy();
  const changed = String(update!.meta?.changedFields ?? '');
  expect(changed).toContain('senderName');
  expect(changed, 'the values themselves never reach the timeline').not.toContain('МЧС РТ');
  expect(JSON.stringify(timeline)).not.toContain('О паводке');

  await admin.dispose();
});

test('editing: an outsider can neither read nor edit the card', async () => {
  const author = await apiLogin(E2E_USER.username, E2E_USER.password);
  const headers = await jsonHeaders(author);
  const doc = await createDraft(author, headers, `Чужой черновик ${Date.now()}`);

  const outsider = await apiLogin(E2E_USER2.username, E2E_USER2.password);
  const outsiderHeaders = await jsonHeaders(outsider);
  expect((await outsider.get(`/api/v1/docflow/documents/${doc.id}`)).status()).toBe(404);
  const edit = await outsider.patch(`/api/v1/docflow/documents/${doc.id}`, {
    headers: outsiderHeaders,
    data: { expectedVersion: 1, subject: 'Не моё' },
  });
  expect(edit.status(), 'the same 404 — no existence leak through the edit path').toBe(404);
  expect((await outsider.get(`/api/v1/docflow/documents/${doc.id}/collaborators`)).status()).toBe(
    404,
  );

  await outsider.dispose();
  await author.dispose();
});
