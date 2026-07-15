import { expect, request, test, type APIRequestContext } from '@playwright/test';
import { csrfHeaders } from './support/api';
import { E2E_ADMIN, STORAGE_STATE } from './support/fixtures';

/**
 * Task 3.7 backend surfaces that power the production docflow UI: queue-count badges,
 * per-row action steps, document links (bidirectional) and the card history feed. Driven
 * over the real API + PostgreSQL as the superadmin (self-contained — no second login).
 */
const API = 'http://localhost:3000';

interface DocumentDto {
  id: string;
  status: string;
  regNumber: string | null;
}
interface ListItem {
  id: string;
  actionStepId: string | null;
}
interface LinkDto {
  id: string;
  documentId: string;
  kind: string;
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
async function draft(
  admin: APIRequestContext,
  headers: Record<string, string>,
): Promise<DocumentDto> {
  return json<DocumentDto>(
    await admin.post('/api/v1/docflow/documents', {
      headers,
      data: {
        docClass: 'internal',
        typeCode: 'order',
        subject: `UI backend ${Date.now()}-${Math.random()}`,
      },
    }),
  );
}

test('docflow 3.7: queue counts, row action steps, links and history', async () => {
  const admin = await request.newContext({ storageState: STORAGE_STATE, baseURL: API });
  const headers = await jsonHeaders(admin);
  const adminId = (await users(admin))[E2E_ADMIN.username];

  // queue-counts returns the four pending-work keys.
  const counts = await json<Record<string, number>>(
    await admin.get('/api/v1/docflow/documents/queue-counts'),
  );
  for (const key of ['to_approve', 'to_sign', 'to_acknowledge', 'my_tasks']) {
    expect(typeof counts[key], `${key} is a number`).toBe('number');
  }

  // Route a document with an approve step on the admin → the to_approve row carries the
  // actionable step id, and the count reflects it.
  const doc = await draft(admin, headers);
  await admin.post(`/api/v1/docflow/documents/${doc.id}/route`, {
    headers,
    data: { steps: [{ order: 1, kind: 'approve', assigneeType: 'user', assigneeId: adminId }] },
  });
  const approveList = await json<{ items: ListItem[] }>(
    await admin.get('/api/v1/docflow/documents?queue=to_approve&page=1&limit=50'),
  );
  const row = approveList.items.find((d) => d.id === doc.id);
  expect(row, 'the routed document is in to_approve').toBeTruthy();
  expect(row!.actionStepId, 'the row carries the approve step id').toBeTruthy();
  expect(
    (await json<Record<string, number>>(await admin.get('/api/v1/docflow/documents/queue-counts')))
      .to_approve,
    'the count includes the routed document',
  ).toBeGreaterThan(0);

  // Non-action queues carry no action step.
  const mine = await json<{ items: ListItem[] }>(
    await admin.get('/api/v1/docflow/documents?queue=mine&page=1&limit=50'),
  );
  expect(mine.items.every((d) => d.actionStepId === null)).toBe(true);

  // Links: relate two documents, both cards see the link, then remove it.
  const a = await draft(admin, headers);
  const b = await draft(admin, headers);
  const linked = await json<LinkDto[]>(
    await admin.post(`/api/v1/docflow/documents/${a.id}/links`, {
      headers,
      data: { targetId: b.id, kind: 'reply' },
    }),
  );
  expect(linked.map((l) => l.documentId)).toContain(b.id);
  // The link shows on the other document too (bidirectional).
  const bLinks = await json<LinkDto[]>(await admin.get(`/api/v1/docflow/documents/${b.id}/links`));
  expect(bLinks.map((l) => l.documentId)).toContain(a.id);
  // A duplicate (reverse direction) is rejected.
  const dup = await admin.post(`/api/v1/docflow/documents/${b.id}/links`, {
    headers,
    data: { targetId: a.id },
  });
  expect(dup.status(), 'duplicate link rejected').toBe(409);
  // Self-link is rejected.
  const self = await admin.post(`/api/v1/docflow/documents/${a.id}/links`, {
    headers,
    data: { targetId: a.id },
  });
  expect(self.status(), 'self-link rejected').toBe(400);
  // Remove (CSRF header only — a bodyless DELETE must not declare a JSON content-type).
  const removeRes = await admin.delete(`/api/v1/docflow/documents/${a.id}/links/${linked[0]!.id}`, {
    headers: await csrfHeaders(admin),
  });
  expect(removeRes.ok(), `remove ${removeRes.status()}`).toBeTruthy();
  expect(await json<LinkDto[]>(removeRes)).toHaveLength(0);

  // History includes the document's creation event.
  const history = await json<{ action: string }[]>(
    await admin.get(`/api/v1/docflow/documents/${a.id}/history`),
  );
  expect(history.some((h) => h.action === 'docflow.document.created')).toBe(true);

  await admin.dispose();
});

test('docflow 3.7: the journals register filters by year', async () => {
  const admin = await request.newContext({ storageState: STORAGE_STATE, baseURL: API });
  const headers = await jsonHeaders(admin);

  // Register a document, then it appears in the current-year register but not a past year.
  const doc = await draft(admin, headers);
  const journals = await json<{ id: string; code: string }[]>(
    await admin.get('/api/v1/docflow/journals'),
  );
  const journalId = journals.find((j) => j.code === 'incoming')?.id ?? journals[0]!.id;
  const reg = await admin.post(`/api/v1/docflow/documents/${doc.id}/actions/register`, {
    headers,
    data: { journalId },
  });
  expect(reg.ok(), `register ${reg.status()}`).toBeTruthy();
  const thisYear = new Date().getFullYear();

  const inYear = await json<{ items: DocumentDto[] }>(
    await admin.get(
      `/api/v1/docflow/documents?queue=registry&journalId=${journalId}&year=${thisYear}&page=1&limit=200`,
    ),
  );
  expect(
    inYear.items.some((d) => d.id === doc.id),
    'registered doc in this year',
  ).toBeTruthy();

  const pastYear = await json<{ items: DocumentDto[] }>(
    await admin.get(
      `/api/v1/docflow/documents?queue=registry&journalId=${journalId}&year=${thisYear - 3}&page=1&limit=200`,
    ),
  );
  expect(
    pastYear.items.some((d) => d.id === doc.id),
    'not in a past year',
  ).toBeFalsy();

  await admin.dispose();
});
