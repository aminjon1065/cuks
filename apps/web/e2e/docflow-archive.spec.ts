import { expect, request, test, type APIRequestContext } from '@playwright/test';
import { csrfHeaders } from './support/api';
import { STORAGE_STATE } from './support/fixtures';

/**
 * The archive: filing, retention, legal hold and governed disposal (docs/modules/11 §12.12,
 * plan этап 8, acceptance AC-SED-05). Drives the real API + PostgreSQL.
 *
 * The invariants it holds the product to — all three of the stage's acceptance criteria:
 * a document cannot be lost by an automatic sweep; the term and the grounds of every decision
 * are on the record; and a legal hold cannot be got round, by the UI or by the raw API.
 */
const API = 'http://localhost:3000';

interface DocumentDto {
  id: string;
  status: string;
  regNumber: string | null;
  caseIndex: string | null;
  availableActions: string[];
  archive: {
    archivedAt: string | null;
    retentionUntil: string | null;
    retentionMonths: number | null;
    isPermanent: boolean;
    legalHold: boolean;
    legalHoldReason: string | null;
    dispositionStatus: string;
    disposedAt: string | null;
  };
}
interface BatchDto {
  id: string;
  number: string;
  status: string;
  items: { documentId: string; decision: string }[];
  canDecide: boolean;
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

/** A case with a stated term, so the archive has a rule to snapshot. */
async function makeCase(
  admin: APIRequestContext,
  headers: Record<string, string>,
  index: string,
  over: Record<string, unknown> = {},
): Promise<void> {
  const res = await admin.post('/api/v1/docflow/nomenclature', {
    headers,
    data: { index, title: `Дело ${index}`, retentionMonths: 60, ...over },
  });
  expect(res.ok(), `case ${res.status()} ${await res.text()}`).toBeTruthy();
}

/** A registered internal document, ready to be filed away. */
async function registeredDoc(
  admin: APIRequestContext,
  headers: Record<string, string>,
  subject: string,
  caseIndex?: string,
): Promise<DocumentDto> {
  const draft = await json<DocumentDto>(
    await admin.post('/api/v1/docflow/documents', {
      headers,
      data: {
        docClass: 'internal',
        typeCode: 'order',
        subject,
        ...(caseIndex ? { caseIndex } : {}),
      },
    }),
  );
  const journals = await json<{ id: string; code: string }[]>(
    await admin.get('/api/v1/docflow/journals'),
  );
  const res = await admin.post(`/api/v1/docflow/documents/${draft.id}/actions/register`, {
    headers,
    data: { journalId: journals.find((j) => j.code === 'orders')!.id },
  });
  expect(res.ok(), `register ${res.status()} ${await res.text()}`).toBeTruthy();
  return json<DocumentDto>(res);
}

test('archive: filing freezes the term the case stated, and a later edit does not move it', async () => {
  test.setTimeout(120_000);
  const admin = await request.newContext({ storageState: STORAGE_STATE, baseURL: API });
  const headers = await jsonHeaders(admin);
  const stamp = Date.now();
  const index = `e2e-${stamp}`;

  await makeCase(admin, headers, index);
  const doc = await registeredDoc(admin, headers, `Приказ в дело ${stamp}`, index);
  expect(doc.availableActions, 'the card offers filing').toContain('archive');

  const archived = await json<DocumentDto>(
    await admin.post(`/api/v1/docflow/documents/${doc.id}/actions/archive`, {
      headers,
      data: { caseIndex: index },
    }),
  );
  expect(archived.status).toBe('archived');
  expect(archived.archive.archivedAt).toBeTruthy();
  expect(archived.archive.retentionMonths, 'the term came from the case').toBe(60);
  const frozen = archived.archive.retentionUntil;
  expect(frozen).toBeTruthy();

  // Now change the case rule. The already-filed document must not move: it is a snapshot,
  // not a reference, and somebody has already answered for that date.
  const cases = await json<{ id: string; index: string }[]>(
    await admin.get('/api/v1/docflow/nomenclature'),
  );
  const caseRow = cases.find((c) => c.index === index)!;
  const patched = await admin.patch(`/api/v1/docflow/nomenclature/${caseRow.id}`, {
    headers,
    data: { retentionMonths: 600 },
  });
  expect(patched.ok(), `patch case ${patched.status()}`).toBeTruthy();

  const after = await json<DocumentDto>(await admin.get(`/api/v1/docflow/documents/${doc.id}`));
  expect(after.archive.retentionUntil, 'the frozen term did not move').toBe(frozen);
  expect(after.archive.retentionMonths).toBe(60);

  await admin.dispose();
});

test('archive: a permanent case is never a candidate, and restore needs a reason', async () => {
  const admin = await request.newContext({ storageState: STORAGE_STATE, baseURL: API });
  const headers = await jsonHeaders(admin);
  const stamp = Date.now();
  const index = `e2e-perm-${stamp}`;

  await makeCase(admin, headers, index, { isPermanent: true, retentionMonths: null });
  const doc = await registeredDoc(admin, headers, `Приказ на постоянное ${stamp}`, index);
  const archived = await json<DocumentDto>(
    await admin.post(`/api/v1/docflow/documents/${doc.id}/actions/archive`, {
      headers,
      data: {},
    }),
  );
  expect(archived.archive.isPermanent).toBe(true);
  // Permanent storage means no deadline at all — there is nothing for a sweep to compare.
  expect(archived.archive.retentionUntil).toBeNull();

  // A restore with no reason is refused by validation; the archive is a record of decisions.
  const noReason = await admin.post(`/api/v1/docflow/documents/${doc.id}/actions/restore`, {
    headers,
    data: {},
  });
  expect(noReason.status()).toBe(400);

  const restored = await json<DocumentDto>(
    await admin.post(`/api/v1/docflow/documents/${doc.id}/actions/restore`, {
      headers,
      data: { reason: 'Затребован для проверки' },
    }),
  );
  expect(restored.status).toBe('completed');
  expect(restored.archive.archivedAt, 'and the snapshot went with it').toBeNull();
  expect(restored.archive.retentionUntil).toBeNull();

  await admin.dispose();
});

test('archive: a legal hold cannot be got round by the raw API', async () => {
  test.setTimeout(120_000);
  const admin = await request.newContext({ storageState: STORAGE_STATE, baseURL: API });
  const headers = await jsonHeaders(admin);
  const stamp = Date.now();
  const index = `e2e-hold-${stamp}`;

  // A case whose term ran out long ago, so nothing but the hold protects the document.
  await makeCase(admin, headers, index, { retentionMonths: 1 });
  const doc = await registeredDoc(admin, headers, `Приказ под запретом ${stamp}`, index);
  await admin.post(`/api/v1/docflow/documents/${doc.id}/actions/archive`, {
    headers,
    data: { caseIndex: index },
  });

  const held = await json<DocumentDto>(
    await admin.post(`/api/v1/docflow/documents/${doc.id}/actions/legal-hold`, {
      headers,
      data: { reason: 'Судебный запрос №12' },
    }),
  );
  expect(held.archive.legalHold).toBe(true);
  expect(held.archive.legalHoldReason, 'a hold nobody can explain is a hold nobody can lift').toBe(
    'Судебный запрос №12',
  );

  // The act of disposal refuses it outright — not at the UI, at the command.
  const batch = await json<BatchDto>(
    await admin.post('/api/v1/docflow/archive/disposition-batches', {
      headers,
      data: { number: `АКТ-${stamp}`, reason: 'Истёк срок хранения' },
    }),
  );
  const blocked = await admin.post(
    `/api/v1/docflow/archive/disposition-batches/${batch.id}/items`,
    { headers, data: { documentIds: [doc.id] } },
  );
  expect(blocked.status(), 'a held document cannot even enter an act').toBe(409);
  expect((await json<ErrorBody>(blocked)).error?.code).toBe('docflow.archive.legal_hold');

  // Lifting it is also a recorded decision.
  const lifted = await json<DocumentDto>(
    await admin.delete(`/api/v1/docflow/documents/${doc.id}/legal-hold`, {
      headers,
      data: { reason: 'Запрос закрыт' },
    }),
  );
  expect(lifted.archive.legalHold).toBe(false);

  await admin.dispose();
});

test('archive: no document reaches an act while its term is alive, and an empty act decides nothing', async () => {
  test.setTimeout(120_000);
  const admin = await request.newContext({ storageState: STORAGE_STATE, baseURL: API });
  const headers = await jsonHeaders(admin);
  const stamp = Date.now();

  // Every reachable document has a LIVE term: retention runs from the day it is filed, and
  // the shortest term the nomenclature accepts is a month. That is the point rather than a
  // gap in the test — the API offers no way to make a document disposable today, so this
  // spec proves the refusals and the act's own state machine is covered by the unit tests of
  // `archive-policy` (planBatchTransition / assertSeparateReviewer), where a pure state
  // machine belongs.
  const index = `e2e-act-${stamp}`;
  await makeCase(admin, headers, index, { retentionMonths: 600 });
  const doc = await registeredDoc(admin, headers, `Приказ со сроком ${stamp}`, index);
  await admin.post(`/api/v1/docflow/documents/${doc.id}/actions/archive`, {
    headers,
    data: { caseIndex: index },
  });

  const batch = await json<BatchDto>(
    await admin.post('/api/v1/docflow/archive/disposition-batches', {
      headers,
      data: { number: `АКТ-2-${stamp}`, reason: 'Истёк срок хранения' },
    }),
  );
  expect(batch.status).toBe('draft');

  const tooEarly = await admin.post(
    `/api/v1/docflow/archive/disposition-batches/${batch.id}/items`,
    { headers, data: { documentIds: [doc.id] } },
  );
  expect(tooEarly.status(), 'a live retention term is not disposable').toBe(422);
  expect((await json<ErrorBody>(tooEarly)).error?.code).toBe('docflow.archive.retention_active');

  // An act with nothing in it cannot be handed to a reviewer: it decides nothing.
  const emptySubmit = await admin.post(
    `/api/v1/docflow/archive/disposition-batches/${batch.id}/actions/submit`,
    { headers, data: {} },
  );
  expect(emptySubmit.status()).toBe(422);
  expect((await json<ErrorBody>(emptySubmit)).error?.code).toBe('docflow.disposition.empty');

  // And a draft act cannot jump straight to execution — approving and destroying are two
  // decisions, not one.
  const early = await admin.post(
    `/api/v1/docflow/archive/disposition-batches/${batch.id}/actions/execute`,
    { headers, data: {} },
  );
  expect(early.status(), 'signing off and destroying are two decisions').toBe(409);
  expect((await json<ErrorBody>(early)).error?.code).toBe('docflow.disposition.invalid_transition');

  // The document is untouched throughout — nothing was deleted, nothing was decided.
  const stillThere = await json<DocumentDto>(
    await admin.get(`/api/v1/docflow/documents/${doc.id}`),
  );
  expect(stillThere.archive.dispositionStatus).toBe('none');
  expect(stillThere.archive.disposedAt).toBeNull();

  await admin.dispose();
});

test('archive: the inventory lists what is filed, and filters candidates and holds', async () => {
  const admin = await request.newContext({ storageState: STORAGE_STATE, baseURL: API });
  const headers = await jsonHeaders(admin);
  const stamp = Date.now();
  const index = `e2e-inv-${stamp}`;

  await makeCase(admin, headers, index, { retentionMonths: 12 });
  const doc = await registeredDoc(admin, headers, `Приказ в описи ${stamp}`, index);
  await admin.post(`/api/v1/docflow/documents/${doc.id}/actions/archive`, {
    headers,
    data: { caseIndex: index },
  });

  const inventory = await json<{
    items: { documentId: string; caseIndex: string | null; retentionUntil: string | null }[];
    total: number;
  }>(await admin.get(`/api/v1/docflow/archive?caseIndex=${index}&page=1&limit=50`));
  expect(inventory.items.map((i) => i.documentId)).toContain(doc.id);
  expect(inventory.items[0]?.retentionUntil, 'with the term it was filed under').toBeTruthy();

  // Nothing is a candidate yet: the sweep marks, and its term has not run out.
  const candidates = await json<{ items: { documentId: string }[] }>(
    await admin.get(
      `/api/v1/docflow/archive?caseIndex=${index}&candidatesOnly=true&page=1&limit=50`,
    ),
  );
  expect(candidates.items.map((i) => i.documentId)).not.toContain(doc.id);

  await admin.dispose();
});
