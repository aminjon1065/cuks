import { createHash, webcrypto } from 'node:crypto';
import { expect, request, test, type APIRequestContext } from '@playwright/test';
import { csrfHeaders } from './support/api';
import { E2E_ADMIN, STORAGE_STATE } from './support/fixtures';

/**
 * The outgoing half of the СЭД process, end to end over the real API + PostgreSQL + MinIO
 * (docs/modules/11 §12.3, plan этап 6, acceptance AC-SED-03): an incoming letter is
 * registered, its answer is drafted from the card, the answer travels approve → sign,
 * the chancellery registers it, and the send is recorded with a receipt.
 *
 * The invariants it holds the product to: the answer inherits the counterparty and the
 * confidentiality of the letter it answers without widening the ДСП allow-list; a type that
 * must be signed cannot be registered unsigned; nothing can be dispatched before it has a
 * number; and a failed attempt survives the successful retry that follows it.
 */
const API = 'http://localhost:3000';

interface DocumentDto {
  id: string;
  status: string;
  regNumber: string | null;
  docClass: string;
  recipientName: string | null;
  confidentiality: string;
  availableActions: string[];
}
interface LinkDto {
  documentId: string;
  kind: string;
  regNumber: string | null;
}
interface RouteStepDto {
  id: string;
  kind: string;
  canAct: boolean;
}
interface RouteDto {
  steps: RouteStepDto[];
}
interface DispatchDto {
  id: string;
  status: string;
  channel: string;
  recipientName: string;
  externalReference: string | null;
  failureMessage: string | null;
  receipt: { fileId: string; name: string } | null;
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

/** A throwaway ECDSA P-256 device key, exactly as the browser would hold one. */
async function makeSigner(): Promise<{ spki: string; sign: (payload: string) => Promise<string> }> {
  const pair = (await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
  ])) as webcrypto.CryptoKeyPair;
  return {
    spki: Buffer.from(await webcrypto.subtle.exportKey('spki', pair.publicKey)).toString('base64'),
    sign: async (payload) =>
      Buffer.from(
        await webcrypto.subtle.sign(
          { name: 'ECDSA', hash: 'SHA-256' },
          pair.privateKey,
          new TextEncoder().encode(payload),
        ),
      ).toString('base64'),
  };
}

async function uploadFile(
  admin: APIRequestContext,
  headers: Record<string, string>,
  content: string,
  name: string,
): Promise<string> {
  const bytes = Buffer.from(content, 'utf8');
  const checksum = createHash('sha256').update(bytes).digest('hex');
  const init = await json<{ uploadId: string; parts: { partNumber: number; url: string }[] }>(
    await admin.post('/api/v1/files/uploads', {
      headers,
      data: { space: 'personal', name, size: bytes.length, mime: 'text/plain' },
    }),
  );
  const put = await admin.put(init.parts[0]!.url, { data: bytes });
  expect(put.ok(), `PUT to MinIO ${put.status()}`).toBeTruthy();
  const node = await json<{ id: string }>(
    await admin.post(`/api/v1/files/uploads/${init.uploadId}/complete`, {
      headers,
      data: {
        parts: [{ partNumber: 1, eTag: put.headers()['etag'] ?? '' }],
        checksumSha256: checksum,
      },
    }),
  );
  return node.id;
}

async function journalId(admin: APIRequestContext, code: string): Promise<string> {
  const journals = await json<{ id: string; code: string }[]>(
    await admin.get('/api/v1/docflow/journals'),
  );
  return journals.find((j) => j.code === code)!.id;
}

test('outgoing: incoming → response → approve → sign → register → send', async () => {
  test.setTimeout(120_000);
  const admin = await request.newContext({ storageState: STORAGE_STATE, baseURL: API });
  const headers = await jsonHeaders(admin);
  const adminId = (await json<{ id: string }>(await admin.get('/api/auth/me'))).id;
  const stamp = Date.now();

  // --- The incoming letter, registered with the sender written on the paper ---------
  const incoming = await json<DocumentDto>(
    await admin.post('/api/v1/docflow/documents/register-incoming', {
      headers,
      data: {
        idempotencyKey: crypto.randomUUID(),
        journalId: await journalId(admin, 'incoming'),
        typeCode: 'letter',
        subject: `Запрос министерства ${stamp}`,
        senderName: 'Министерство энергетики РТ',
        senderContact: 'minenergo@example.tj',
        responseDueAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      },
    }),
  );
  expect(incoming.regNumber, 'the letter is numbered').toBeTruthy();

  // --- The answer, drafted from the card ------------------------------------------
  const created = await admin.post(
    `/api/v1/docflow/documents/${incoming.id}/actions/create-response`,
    { headers, data: { typeCode: 'letter', startRoute: false, signerId: adminId } },
  );
  expect(created.ok(), `create-response ${created.status()} ${await created.text()}`).toBeTruthy();
  const response = await json<DocumentDto>(created);

  expect(response.docClass, 'the answer is an outgoing document').toBe('outgoing');
  expect(response.status).toBe('draft');
  // The counterparty's roles swap: whoever wrote to us is who we write back to.
  expect(response.recipientName).toBe('Министерство энергетики РТ');
  expect(response.confidentiality).toBe(incoming.confidentiality);

  // Both cards show the relation from the single link row.
  const links = await json<LinkDto[]>(
    await admin.get(`/api/v1/docflow/documents/${response.id}/links`),
  );
  expect(links).toHaveLength(1);
  expect(links[0]).toMatchObject({ documentId: incoming.id, kind: 'reply' });
  const backLinks = await json<LinkDto[]>(
    await admin.get(`/api/v1/docflow/documents/${incoming.id}/links`),
  );
  expect(backLinks[0], 'the incoming card sees its answer').toMatchObject({
    documentId: response.id,
    kind: 'reply',
  });

  // --- Nothing may be dispatched before there is a number --------------------------
  const early = await admin.post(`/api/v1/docflow/documents/${response.id}/dispatches`, {
    headers,
    data: { channel: 'courier', recipientName: 'Министерство энергетики РТ' },
  });
  expect(early.status(), 'a draft has nothing to put on the envelope').toBe(422);
  expect((await json<ErrorBody>(early)).error?.code).toBe('docflow.dispatch.not_registered');

  // --- The answer travels: approve → sign ------------------------------------------
  const fileId = await uploadFile(admin, headers, `Ответ на запрос ${stamp}`, `otvet-${stamp}.txt`);
  const attached = await admin.post(`/api/v1/docflow/documents/${response.id}/files`, {
    headers,
    data: { fileId, kind: 'main' },
  });
  expect(attached.ok(), `attach ${attached.status()}`).toBeTruthy();

  // A draft outgoing letter is otherwise registrable straight away — but «Письмо» declares
  // a signature, so the number is refused until one exists over the current body.
  const outgoingJournal = await journalId(admin, 'outgoing');
  const unsigned = await admin.post(`/api/v1/docflow/documents/${response.id}/actions/register`, {
    headers,
    data: { journalId: outgoingJournal },
  });
  expect(unsigned.status(), 'an unsigned outgoing letter is not registrable').toBe(422);
  expect((await json<ErrorBody>(unsigned)).error?.code).toBe('docflow.document.signature_required');

  const routed = await admin.post(`/api/v1/docflow/documents/${response.id}/route`, {
    headers,
    data: {
      steps: [
        { order: 1, kind: 'approve', assigneeType: 'user', assigneeId: adminId },
        { order: 2, kind: 'sign', assigneeType: 'user', assigneeId: adminId },
      ],
    },
  });
  expect(routed.ok(), `route ${routed.status()}`).toBeTruthy();

  const routes = await json<RouteDto[]>(
    await admin.get(`/api/v1/docflow/documents/${response.id}/routes`),
  );
  const approveStep = routes[0]!.steps.find((s) => s.kind === 'approve' && s.canAct)!;
  const approved = await admin.post(
    `/api/v1/docflow/route-steps/${approveStep.id}/actions/approve`,
    { headers, data: {} },
  );
  expect(approved.ok(), `approve ${approved.status()}`).toBeTruthy();

  const signer = await makeSigner();
  const cert = await json<{ id: string }>(
    await admin.post('/api/v1/signatures/activate', {
      headers,
      data: { publicKeySpki: signer.spki, deviceLabel: `e2e outgoing ${stamp}` },
    }),
  );
  const payload = await json<{ payload: string }>(
    await admin.get(`/api/v1/docflow/documents/${response.id}/sign-payload`),
  );
  const signed = await admin.post(`/api/v1/docflow/documents/${response.id}/actions/sign`, {
    headers,
    data: {
      certificateId: cert.id,
      signature: await signer.sign(payload.payload),
      password: E2E_ADMIN.password,
    },
  });
  expect(signed.ok(), `sign ${signed.status()} ${await signed.text()}`).toBeTruthy();

  // --- Registration: the right book, and only the right book -----------------------
  const wrongBook = await admin.post(`/api/v1/docflow/documents/${response.id}/actions/register`, {
    headers,
    data: { journalId: await journalId(admin, 'incoming') },
  });
  expect(wrongBook.status(), 'an outgoing letter is not numbered ВХ-…').toBe(422);
  expect((await json<ErrorBody>(wrongBook)).error?.code).toBe('docflow.journal.class_mismatch');

  const registered = await admin.post(`/api/v1/docflow/documents/${response.id}/actions/register`, {
    headers,
    data: { journalId: outgoingJournal },
  });
  expect(
    registered.ok(),
    `register ${registered.status()} ${await registered.text()}`,
  ).toBeTruthy();
  const numbered = await json<DocumentDto>(registered);
  expect(numbered.regNumber, 'the answer has its own outgoing number').toBeTruthy();
  expect(numbered.regNumber).not.toBe(incoming.regNumber);
  expect(numbered.availableActions, 'and the card now offers a send').toContain('dispatch');

  // --- The send: a failed attempt, then a successful retry with a receipt ----------
  const first = await json<DispatchDto>(
    await admin.post(`/api/v1/docflow/documents/${response.id}/dispatches`, {
      headers,
      data: {
        channel: 'postal',
        recipientName: 'Министерство энергетики РТ',
        recipientAddress: 'г. Душанбе, пр. Рудаки, 1',
      },
    }),
  );
  expect(first.status).toBe('pending');

  const failed = await json<DispatchDto>(
    await admin.post(`/api/v1/docflow/dispatches/${first.id}/actions/fail`, {
      headers,
      data: { failureCode: 'returned', failureMessage: 'Конверт вернулся: адрес изменился' },
    }),
  );
  expect(failed.status).toBe('failed');

  const retried = await json<DispatchDto>(
    await admin.post(`/api/v1/docflow/dispatches/${first.id}/actions/retry`, {
      headers,
      data: {},
    }),
  );
  expect(retried.status).toBe('pending');
  expect(retried.id, 'a retry is a NEW attempt').not.toBe(first.id);
  expect(retried.recipientName, 'carrying the same addressee').toBe(first.recipientName);

  const receiptId = await uploadFile(admin, headers, 'Почтовая квитанция', `kvit-${stamp}.txt`);
  const confirmed = await json<DispatchDto>(
    await admin.post(`/api/v1/docflow/dispatches/${retried.id}/actions/confirm`, {
      headers,
      data: { externalReference: `RB${stamp}TJ`, receiptFileId: receiptId },
    }),
  );
  expect(confirmed.status).toBe('sent');
  expect(confirmed.externalReference).toBe(`RB${stamp}TJ`);
  expect(confirmed.receipt?.fileId, 'the receipt is attached to the document').toBe(receiptId);

  // The failure is still there — a success must not rewrite the history that preceded it.
  const history = await json<DispatchDto[]>(
    await admin.get(`/api/v1/docflow/documents/${response.id}/dispatches`),
  );
  expect(history).toHaveLength(2);
  expect(history.find((d) => d.id === first.id)?.failureMessage).toBe(
    'Конверт вернулся: адрес изменился',
  );

  // Deciding a decided attempt is refused rather than silently re-applied.
  const twice = await admin.post(`/api/v1/docflow/dispatches/${retried.id}/actions/confirm`, {
    headers,
    data: {},
  });
  expect(twice.status()).toBe(409);
  expect((await json<ErrorBody>(twice)).error?.code).toBe('docflow.dispatch.not_pending');

  // The sent letter is done: nothing else is owed on it.
  const finalDoc = await json<DocumentDto>(
    await admin.get(`/api/v1/docflow/documents/${response.id}`),
  );
  expect(finalDoc.status, 'a sent answer with no obligations left is completed').toBe('completed');

  // The receipt reads only through the document policy, like any other body.
  const receiptRead = await admin.get(
    `/api/v1/docflow/documents/${response.id}/files/${receiptId}/download`,
  );
  expect([200, 302, 403].includes(receiptRead.status()), 'served or held by the AV gate').toBe(
    true,
  );

  await admin.dispose();
});

test('outgoing: a response inherits ДСП without widening its allow-list', async () => {
  const admin = await request.newContext({ storageState: STORAGE_STATE, baseURL: API });
  const headers = await jsonHeaders(admin);
  const stamp = Date.now();

  const incoming = await json<DocumentDto>(
    await admin.post('/api/v1/docflow/documents/register-incoming', {
      headers,
      data: {
        idempotencyKey: crypto.randomUUID(),
        journalId: await journalId(admin, 'incoming'),
        typeCode: 'letter',
        subject: `ДСП запрос ${stamp}`,
        confidentiality: 'dsp',
        senderName: 'Комитет',
      },
    }),
  );
  const access = await json<{ confidentiality: string; members: { userId: string }[] }>(
    await admin.get(`/api/v1/docflow/documents/${incoming.id}/access`),
  );

  const response = await json<DocumentDto>(
    await admin.post(`/api/v1/docflow/documents/${incoming.id}/actions/create-response`, {
      headers,
      data: { typeCode: 'letter', startRoute: false },
    }),
  );
  // The answer quotes the letter, so a less-restricted answer would leak the letter.
  expect(response.confidentiality).toBe('dsp');

  const responseAccess = await json<{ confidentiality: string; members: { userId: string }[] }>(
    await admin.get(`/api/v1/docflow/documents/${response.id}/access`),
  );
  const sourceMembers = new Set(access.members.map((m) => m.userId));
  expect(
    responseAccess.members.every((m) => sourceMembers.has(m.userId)),
    'the answer never reaches anyone the letter did not',
  ).toBe(true);

  await admin.dispose();
});

test('outgoing: an answer is only prepared for a registered incoming document', async () => {
  const admin = await request.newContext({ storageState: STORAGE_STATE, baseURL: API });
  const headers = await jsonHeaders(admin);

  const draft = await json<{ id: string }>(
    await admin.post('/api/v1/docflow/documents', {
      headers,
      data: { docClass: 'incoming', typeCode: 'letter', subject: `Черновик ${Date.now()}` },
    }),
  );
  const res = await admin.post(`/api/v1/docflow/documents/${draft.id}/actions/create-response`, {
    headers,
    data: { typeCode: 'letter' },
  });
  expect(res.status()).toBe(422);
  expect((await json<ErrorBody>(res)).error?.code).toBe('docflow.response.source_not_registered');

  // And an outgoing document is not something one answers.
  const outgoing = await json<{ id: string }>(
    await admin.post('/api/v1/docflow/documents', {
      headers,
      data: { docClass: 'outgoing', typeCode: 'letter', subject: `Исходящий ${Date.now()}` },
    }),
  );
  const wrongClass = await admin.post(
    `/api/v1/docflow/documents/${outgoing.id}/actions/create-response`,
    { headers, data: { typeCode: 'letter' } },
  );
  expect(wrongClass.status()).toBe(422);
  expect((await json<ErrorBody>(wrongClass)).error?.code).toBe(
    'docflow.response.source_not_incoming',
  );

  await admin.dispose();
});
