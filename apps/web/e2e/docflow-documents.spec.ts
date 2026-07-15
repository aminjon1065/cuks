import { expect, request, test } from '@playwright/test';
import { apiLogin, csrfHeaders } from './support/api';
import { E2E_USER, E2E_USER2, STORAGE_STATE } from './support/fixtures';

/**
 * Document card + registration + visibility (docs/modules/11 §3/§4, task 3.2). Drives
 * the real API + PostgreSQL: a draft is created, registered (minting a journal number
 * via the task-3.1 counter), advanced through the status machine, and a ДСП document
 * is proven invisible to a non-participant. The superadmin storageState holds
 * docflow.register (via wildcard); e2e_user/e2e_user2 are plain employees.
 */
const API = 'http://localhost:3000';

interface JournalDto {
  id: string;
  code: string;
}
interface DocumentDto {
  id: string;
  status: string;
  regNumber: string | null;
}

test('docflow: create → register mints a journal number, then advance the status', async () => {
  const admin = await request.newContext({ storageState: STORAGE_STATE, baseURL: API });
  const headers = { ...(await csrfHeaders(admin)), 'content-type': 'application/json' };

  const journals = (await (await admin.get('/api/v1/docflow/journals')).json()) as JournalDto[];
  const orders = journals.find((j) => j.code === 'orders');
  expect(orders, 'the seeded "orders" journal exists').toBeTruthy();

  const draftRes = await admin.post('/api/v1/docflow/documents', {
    headers,
    data: { docClass: 'internal', typeCode: 'order', subject: `E2E приказ ${Date.now()}` },
  });
  expect(draftRes.ok(), `create ${draftRes.status()}`).toBeTruthy();
  const draft = (await draftRes.json()) as DocumentDto;
  expect(draft.status).toBe('draft');
  expect(draft.regNumber).toBeNull();

  const regRes = await admin.post(`/api/v1/docflow/documents/${draft.id}/actions/register`, {
    headers,
    data: { journalId: orders!.id },
  });
  expect(regRes.ok(), `register ${regRes.status()}`).toBeTruthy();
  const registered = (await regRes.json()) as DocumentDto;
  expect(registered.status).toBe('registered');
  // The number is rendered from the "orders" template {П}-{YYYY}/{seq4}.
  expect(registered.regNumber).toMatch(/^П-\d{4}\/\d{4}$/);

  // A valid lifecycle advance, then a rejected illegal jump.
  const advance = await admin.post(`/api/v1/docflow/documents/${draft.id}/actions/status`, {
    headers,
    data: { status: 'in_progress' },
  });
  expect(advance.ok(), `advance ${advance.status()}`).toBeTruthy();
  const illegal = await admin.post(`/api/v1/docflow/documents/${draft.id}/actions/status`, {
    headers,
    data: { status: 'draft' },
  });
  expect(illegal.status(), 'in_progress → draft is not a legal transition').toBe(422);

  await admin.dispose();
});

test('docflow: an author cannot self-register via a status change', async () => {
  // e2e_user is an employee (docflow.create, NOT docflow.register). Reaching
  // "registered" must go through the register action (which mints a number), never a
  // plain status change — otherwise a document would be registered without a number.
  const author = await apiLogin(E2E_USER.username, E2E_USER.password);
  const headers = { ...(await csrfHeaders(author)), 'content-type': 'application/json' };
  const draft = (await (
    await author.post('/api/v1/docflow/documents', {
      headers,
      data: { docClass: 'internal', typeCode: 'memo', subject: `Self-reg ${Date.now()}` },
    })
  ).json()) as DocumentDto;

  const res = await author.post(`/api/v1/docflow/documents/${draft.id}/actions/status`, {
    headers,
    data: { status: 'registered' },
  });
  expect(res.status(), 'draft → registered is not a manual transition').toBe(422);

  const after = (await (
    await author.get(`/api/v1/docflow/documents/${draft.id}`)
  ).json()) as DocumentDto;
  expect(after.status).toBe('draft');
  expect(after.regNumber).toBeNull();

  await author.dispose();
});

test('docflow: a ДСП document is invisible to a non-participant', async () => {
  const author = await apiLogin(E2E_USER.username, E2E_USER.password);
  const other = await apiLogin(E2E_USER2.username, E2E_USER2.password);

  const created = await author.post('/api/v1/docflow/documents', {
    headers: { ...(await csrfHeaders(author)), 'content-type': 'application/json' },
    data: {
      docClass: 'internal',
      typeCode: 'memo',
      subject: `ДСП ${Date.now()}`,
      confidentiality: 'dsp',
    },
  });
  expect(created.ok(), `create dsp ${created.status()}`).toBeTruthy();
  const dsp = (await created.json()) as DocumentDto;

  // The author sees it…
  const authorView = await author.get(`/api/v1/docflow/documents/${dsp.id}`);
  expect(authorView.ok()).toBeTruthy();
  // …a non-participant employee gets a 404 (existence never leaks), not a 403.
  const otherView = await other.get(`/api/v1/docflow/documents/${dsp.id}`);
  expect(otherView.status()).toBe(404);

  await author.dispose();
  await other.dispose();
});
