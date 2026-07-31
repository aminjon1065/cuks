import { expect, request, test, type APIRequestContext } from '@playwright/test';
import { apiLogin, csrfHeaders } from './support/api';
import { E2E_USER, E2E_USER2, STORAGE_STATE } from './support/fixtures';

/**
 * The incoming process: proposal → signer decision → pre-execution reading gate
 * (docs/modules/11 §12.11, plan этап 5, acceptance AC-SED-01/02). Drives the real API +
 * PostgreSQL: only the named signer decides, a rejection issues nothing, an approval with
 * readers keeps the instruction invisible until they read it, and the last reader opens the
 * gate immediately.
 */
const API = 'http://localhost:3000';

interface ProposalDto {
  id: string;
  status: string;
  canDecide: boolean;
  resolutionId: string | null;
  decidedForName: string | null;
  gate: {
    id: string;
    releaseAt: string | null;
    releasedAt: string | null;
    releasedReason: string | null;
    lines: { userId: string; status: string }[];
  } | null;
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
async function meId(ctx: APIRequestContext): Promise<string> {
  return (await json<{ id: string }>(await ctx.get('/api/auth/me'))).id;
}

/** Register an incoming document — a resolution needs a numbered document. */
async function registerIncoming(
  ctx: APIRequestContext,
  headers: Record<string, string>,
  subject: string,
): Promise<string> {
  const journals = await json<{ id: string; code: string }[]>(
    await ctx.get('/api/v1/docflow/journals'),
  );
  const incoming = journals.find((j) => j.code === 'incoming')!;
  const res = await ctx.post('/api/v1/docflow/documents/register-incoming', {
    headers,
    data: {
      idempotencyKey: crypto.randomUUID(),
      journalId: incoming.id,
      typeCode: 'letter',
      subject,
    },
  });
  expect(res.ok(), `register ${res.status()} ${await res.text()}`).toBeTruthy();
  return (await json<{ id: string }>(res)).id;
}

async function propose(
  ctx: APIRequestContext,
  headers: Record<string, string>,
  documentId: string,
  data: Record<string, unknown>,
): Promise<ProposalDto> {
  const res = await ctx.post(`/api/v1/docflow/documents/${documentId}/resolution-proposals`, {
    headers,
    data,
  });
  expect(res.ok(), `propose ${res.status()} ${await res.text()}`).toBeTruthy();
  const proposal = await json<ProposalDto>(res);
  const submitted = await ctx.post(
    `/api/v1/docflow/resolution-proposals/${proposal.id}/actions/submit`,
    { headers, data: {} },
  );
  expect(submitted.ok(), `submit ${submitted.status()}`).toBeTruthy();
  return json<ProposalDto>(submitted);
}

test('proposals: only the named signer decides, and a rejection issues nothing', async () => {
  const admin = await request.newContext({ storageState: STORAGE_STATE, baseURL: API });
  const headers = await jsonHeaders(admin);
  const ids = await userIds(admin);
  const me = await meId(admin);
  const documentId = await registerIncoming(admin, headers, `Проект резолюции ${Date.now()}`);

  // Signer is someone else, so the drafter must not be able to decide their own proposal.
  const proposal = await propose(admin, headers, documentId, {
    text: 'Прошу рассмотреть и доложить',
    signerId: ids[E2E_USER.username],
    responsibleExecutorId: ids[E2E_USER2.username],
  });
  expect(proposal.status).toBe('pending');

  const outsider = await apiLogin(E2E_USER2.username, E2E_USER2.password);
  const outsiderHeaders = await jsonHeaders(outsider);
  const stolen = await outsider.post(
    `/api/v1/docflow/resolution-proposals/${proposal.id}/actions/approve`,
    { headers: outsiderHeaders, data: {} },
  );
  // 404, not 403: being NAMED in a pending proposal does not make the document visible, and
  // the visibility gate runs first — so a stranger learns nothing about a proposal that
  // exists. (The signer_mismatch branch itself is covered exhaustively by the unit tests,
  // where a pure policy belongs.)
  expect(stolen.status(), 'a resolution carries the authority of whoever signed it').toBe(404);
  await outsider.dispose();

  // The signer returns it instead — no resolution is created.
  const signer = await apiLogin(E2E_USER.username, E2E_USER.password);
  const signerHeaders = await jsonHeaders(signer);
  const rejected = await signer.post(
    `/api/v1/docflow/resolution-proposals/${proposal.id}/actions/reject`,
    { headers: signerHeaders, data: { comment: 'Уточните срок' } },
  );
  expect(rejected.ok(), `reject ${rejected.status()}`).toBeTruthy();
  const after = await json<ProposalDto>(rejected);
  expect(after.status).toBe('rejected');
  expect(after.resolutionId, 'a returned proposal issues no instruction').toBeNull();

  // And a decided proposal cannot be decided again.
  const twice = await signer.post(
    `/api/v1/docflow/resolution-proposals/${proposal.id}/actions/approve`,
    { headers: signerHeaders, data: {} },
  );
  expect(twice.status()).toBe(409);
  expect((await json<ErrorBody>(twice)).error?.code).toBe('docflow.proposal.not_pending');

  await signer.dispose();
  await admin.dispose();
  expect(me).toBeTruthy();
});

test('proposals: approval without readers activates the instruction immediately', async () => {
  const admin = await request.newContext({ storageState: STORAGE_STATE, baseURL: API });
  const headers = await jsonHeaders(admin);
  const ids = await userIds(admin);
  const me = await meId(admin);
  const documentId = await registerIncoming(admin, headers, `Без ознакомления ${Date.now()}`);

  // Signer is the caller, so the approval can be driven in one session.
  const proposal = await propose(admin, headers, documentId, {
    text: 'Исполнить',
    signerId: me,
    responsibleExecutorId: ids[E2E_USER2.username],
  });
  expect(proposal.canDecide, 'the signer sees it as theirs to decide').toBe(true);

  const approved = await json<ProposalDto>(
    await admin.post(`/api/v1/docflow/resolution-proposals/${proposal.id}/actions/approve`, {
      headers,
      data: {},
    }),
  );
  expect(approved.status).toBe('approved');
  expect(approved.resolutionId, 'the instruction exists').toBeTruthy();
  // A gate with nobody behind it would delay work for no reason.
  expect(approved.gate, 'and there is no gate to wait on').toBeNull();

  await admin.dispose();
});

test('proposals: readers gate the instruction, and the last one opens it early', async () => {
  const admin = await request.newContext({ storageState: STORAGE_STATE, baseURL: API });
  const headers = await jsonHeaders(admin);
  const ids = await userIds(admin);
  const me = await meId(admin);
  const documentId = await registerIncoming(admin, headers, `С ознакомлением ${Date.now()}`);

  const proposal = await propose(admin, headers, documentId, {
    text: 'Ознакомить и исполнить',
    signerId: me,
    responsibleExecutorId: ids[E2E_USER2.username],
    acquaintUserIds: [ids[E2E_USER.username], ids[E2E_USER2.username]],
  });

  const approved = await json<ProposalDto>(
    await admin.post(`/api/v1/docflow/resolution-proposals/${proposal.id}/actions/approve`, {
      headers,
      data: {},
    }),
  );
  expect(approved.gate, 'the reading gate exists').toBeTruthy();
  expect(approved.gate!.releasedAt, 'and starts shut').toBeNull();
  expect(approved.gate!.releaseAt, 'with a timeout four hours out').toBeTruthy();
  expect(approved.gate!.lines).toHaveLength(2);
  expect(approved.gate!.lines.every((l) => l.status === 'pending')).toBe(true);

  // The executor does not see the instruction while the gate is shut — enforced by the
  // queue query, not the UI.
  const executor = await apiLogin(E2E_USER2.username, E2E_USER2.password);
  const executorHeaders = await jsonHeaders(executor);
  // Asserted on THIS document, not on an empty queue: the executor legitimately has other
  // instructions from earlier fixtures, and a total of zero would be testing the seed.
  const myTasks = async (): Promise<string[]> =>
    (
      await json<{ items: { id: string }[] }>(
        await executor.get('/api/v1/docflow/documents?queue=my_tasks&page=1&limit=200'),
      )
    ).items.map((d) => d.id);
  expect(await myTasks(), 'the instruction is invisible behind the gate').not.toContain(documentId);

  // First reader acknowledges — still one outstanding, so the gate stays shut.
  const gateId = approved.gate!.id;
  const firstAck = await json<ProposalDto['gate']>(
    await executor.post(`/api/v1/docflow/acquaintance-batches/${gateId}/actions/acknowledge`, {
      headers: executorHeaders,
      data: {},
    }),
  );
  expect(firstAck!.releasedAt, 'one reader left, so the gate holds').toBeNull();

  // Acknowledging twice is harmless.
  const again = await executor.post(
    `/api/v1/docflow/acquaintance-batches/${gateId}/actions/acknowledge`,
    { headers: executorHeaders, data: {} },
  );
  expect(again.ok(), 'a double click must not strand the batch').toBeTruthy();

  // The last reader opens it — the point of the wait is the reading, not the clock.
  const reader = await apiLogin(E2E_USER.username, E2E_USER.password);
  const readerHeaders = await jsonHeaders(reader);
  const finalAck = await json<ProposalDto['gate']>(
    await reader.post(`/api/v1/docflow/acquaintance-batches/${gateId}/actions/acknowledge`, {
      headers: readerHeaders,
      data: {},
    }),
  );
  expect(finalAck!.releasedAt, 'the gate is open').toBeTruthy();
  expect(finalAck!.releasedReason).toBe('all_acknowledged');
  expect(
    finalAck!.lines.every((l) => l.status === 'acknowledged'),
    'and everyone is recorded as having read it, not expired',
  ).toBe(true);
  await reader.dispose();

  expect(await myTasks(), 'now the executor has their instruction').toContain(documentId);

  await executor.dispose();
  await admin.dispose();
});

test('proposals: a proposal needs a registered document', async () => {
  const admin = await request.newContext({ storageState: STORAGE_STATE, baseURL: API });
  const headers = await jsonHeaders(admin);
  const me = await meId(admin);
  const draft = await json<{ id: string }>(
    await admin.post('/api/v1/docflow/documents', {
      headers,
      data: { docClass: 'incoming', typeCode: 'letter', subject: `Черновик ${Date.now()}` },
    }),
  );
  const res = await admin.post(`/api/v1/docflow/documents/${draft.id}/resolution-proposals`, {
    headers,
    data: { text: 'Рано', signerId: me },
  });
  // An instruction about an unnumbered draft would refer to nothing citable.
  expect(res.status()).toBe(422);
  expect((await json<ErrorBody>(res)).error?.code).toBe('docflow.proposal.document_not_registered');

  await admin.dispose();
});
