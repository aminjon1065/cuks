import { expect, request, test, type APIRequestContext } from '@playwright/test';
import { apiLogin, csrfHeaders } from './support/api';
import { E2E_USER, E2E_USER2, STORAGE_STATE } from './support/fixtures';

/**
 * ДСП restricted access (docs/09-security.md §3, task 3.10). Drives the real rules over the API +
 * PostgreSQL: a ДСП document needs BOTH docflow.confidential.view AND access-list membership, so an
 * access-listed employee without the право still cannot see it (nor find it in a list); the author
 * can; a non-author open is written to the read log; and only the author / a confidential.view
 * holder may manage the grif.
 */
const API = 'http://localhost:3000';

interface DocumentDto {
  id: string;
}
interface AccessDto {
  confidentiality: string;
  members: { userId: string; name: string | null }[];
  canManage: boolean;
}
interface ReadLogEntry {
  actorId: string;
  entityType: string;
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

test('dsp: access list alone is not enough — the confidential.view право is required', async () => {
  const admin = await request.newContext({ storageState: STORAGE_STATE, baseURL: API });
  const ids = await userIds(admin);
  await admin.dispose();

  // The author (a plain employee) creates a draft and marks it ДСП, listing e2e_user2.
  const author = await apiLogin(E2E_USER.username, E2E_USER.password);
  const authorHeaders = await jsonHeaders(author);
  const doc = await json<DocumentDto>(
    await author.post('/api/v1/docflow/documents', {
      headers: authorHeaders,
      data: { docClass: 'incoming', typeCode: 'letter', subject: `ДСП ${Date.now()}` },
    }),
  );
  const setRes = await author.patch(`/api/v1/docflow/documents/${doc.id}/access`, {
    headers: authorHeaders,
    data: { confidentiality: 'dsp', accessList: [ids[E2E_USER2.username]] },
  });
  expect(setRes.ok(), `set access ${setRes.status()}`).toBeTruthy();

  // The author still sees the card and the access block reflects the grif + member.
  expect((await author.get(`/api/v1/docflow/documents/${doc.id}`)).ok()).toBeTruthy();
  const access = await json<AccessDto>(
    await author.get(`/api/v1/docflow/documents/${doc.id}/access`),
  );
  expect(access.confidentiality).toBe('dsp');
  expect(access.members.map((m) => m.userId)).toContain(ids[E2E_USER2.username]);

  // e2e_user2 is on the access list but has no docflow.confidential.view → cannot see the document
  // (404, no existence leak) and it does not surface in their queue.
  const other = await apiLogin(E2E_USER2.username, E2E_USER2.password);
  expect((await other.get(`/api/v1/docflow/documents/${doc.id}`)).status()).toBe(404);
  const mine = await json<{ items: DocumentDto[] }>(
    await other.get('/api/v1/docflow/documents?queue=mine&page=1&limit=100'),
  );
  expect(
    mine.items.some((d) => d.id === doc.id),
    'ДСП is hidden from the list',
  ).toBe(false);

  // e2e_user2 also may not manage the grif (not author, no confidential.view) → 404.
  expect(
    (
      await other.patch(`/api/v1/docflow/documents/${doc.id}/access`, {
        headers: await jsonHeaders(other),
        data: { confidentiality: 'normal', accessList: [] },
      })
    ).status(),
  ).toBe(404);

  await author.dispose();
  await other.dispose();
});

test('dsp: a non-author open is written to the read log', async () => {
  const admin = await request.newContext({ storageState: STORAGE_STATE, baseURL: API });
  const ids = await userIds(admin);

  const author = await apiLogin(E2E_USER.username, E2E_USER.password);
  const authorHeaders = await jsonHeaders(author);
  const doc = await json<DocumentDto>(
    await author.post('/api/v1/docflow/documents', {
      headers: authorHeaders,
      data: { docClass: 'incoming', typeCode: 'letter', subject: `ДСП-лог ${Date.now()}` },
    }),
  );
  await author.patch(`/api/v1/docflow/documents/${doc.id}/access`, {
    headers: authorHeaders,
    data: { confidentiality: 'dsp', accessList: [] },
  });

  // The superadmin (a non-author who can always see ДСП) opens the card — this logs a read.
  expect((await admin.get(`/api/v1/docflow/documents/${doc.id}`)).ok()).toBeTruthy();

  // The read log (visible to the author) records the superadmin's open. The doc is fresh so any
  // entry is that open; the write is fire-and-forget, so poll briefly.
  const adminId = ids['e2e_admin'];
  let entry: ReadLogEntry | undefined;
  for (let i = 0; i < 10 && !entry; i++) {
    const log = await json<ReadLogEntry[]>(
      await author.get(`/api/v1/docflow/documents/${doc.id}/read-log`),
    );
    entry = log.find((e) => e.entityType === 'document');
    if (!entry) await new Promise((r) => setTimeout(r, 300));
  }
  expect(entry, 'the open is recorded in the read log').toBeTruthy();
  expect(entry!.actorId, 'logged as the superadmin who opened it').toBe(adminId);

  await admin.dispose();
  await author.dispose();
});
