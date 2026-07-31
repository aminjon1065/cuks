import { expect, request, test, type APIRequestContext } from '@playwright/test';
import { apiLogin, csrfHeaders } from './support/api';
import { E2E_USER, STORAGE_STATE } from './support/fixtures';

/**
 * Atomic incoming registration (docs/modules/11 §12.2, plan этап 1B). Drives the real
 * API + PostgreSQL: one command creates the card, mints the number and links the files;
 * a replay of the same idempotency key — the network-retry case, where the request
 * committed but the response never arrived — returns the ORIGINAL document and number
 * instead of registering a second one; and a command that fails validation leaves no
 * document behind and burns no number.
 */
const API = 'http://localhost:3000';

interface DocumentDto {
  id: string;
  status: string;
  regNumber: string | null;
  subject: string;
}
interface JournalDto {
  id: string;
  code: string;
}
interface ListDto {
  items: { id: string }[];
  total: number;
}

async function journalId(ctx: APIRequestContext, code: string): Promise<string> {
  const journals = (await (await ctx.get('/api/v1/docflow/journals')).json()) as JournalDto[];
  const found = journals.find((j) => j.code === code);
  expect(found, `the seeded "${code}" journal exists`).toBeTruthy();
  return found!.id;
}

/** The `{seq4}` tail of a `ВХ-YYYY/NNNN` registration number. */
function seqOf(regNumber: string | null): number {
  const match = /\/(\d+)$/.exec(regNumber ?? '');
  expect(match, `"${regNumber}" ends in a sequence`).toBeTruthy();
  return Number(match![1]);
}

/** Register a throwaway incoming document and return its card. */
async function registerOne(
  ctx: APIRequestContext,
  headers: Record<string, string>,
  journal: string,
  subject: string,
): Promise<DocumentDto> {
  const res = await ctx.post('/api/v1/docflow/documents/register-incoming', {
    headers,
    data: { idempotencyKey: crypto.randomUUID(), journalId: journal, typeCode: 'letter', subject },
  });
  expect(res.ok(), `register-incoming ${res.status()}`).toBeTruthy();
  return (await res.json()) as DocumentDto;
}

test('docflow: register-incoming is atomic and idempotent on a client key', async () => {
  const admin = await request.newContext({ storageState: STORAGE_STATE, baseURL: API });
  const headers = { ...(await csrfHeaders(admin)), 'content-type': 'application/json' };
  const incoming = await journalId(admin, 'incoming');

  const key = crypto.randomUUID();
  const subject = `E2E входящий ${Date.now()}`;
  const command = { idempotencyKey: key, journalId: incoming, typeCode: 'letter', subject };

  const first = await admin.post('/api/v1/docflow/documents/register-incoming', {
    headers,
    data: command,
  });
  expect(first.ok(), `register-incoming ${first.status()}`).toBeTruthy();
  const registered = (await first.json()) as DocumentDto;
  // One call produced a fully registered card — no intermediate draft was ever visible.
  expect(registered.status).toBe('registered');
  expect(registered.subject).toBe(subject);
  expect(registered.regNumber).toMatch(/^ВХ-\d{4}\/\d{4}$/);

  // The retry case: the client never saw the response and sends the very same command.
  const replay = await admin.post('/api/v1/docflow/documents/register-incoming', {
    headers,
    data: command,
  });
  expect(replay.ok(), `replay ${replay.status()}`).toBeTruthy();
  const replayed = (await replay.json()) as DocumentDto;
  expect(replayed.id, 'the replay returns the original document').toBe(registered.id);
  expect(replayed.regNumber, 'and its original number — not a second one').toBe(
    registered.regNumber,
  );

  await admin.dispose();
});

test('docflow: a failed register-incoming leaves no draft and burns no number', async () => {
  const admin = await request.newContext({ storageState: STORAGE_STATE, baseURL: API });
  const headers = { ...(await csrfHeaders(admin)), 'content-type': 'application/json' };
  const incoming = await journalId(admin, 'incoming');

  const stamp = Date.now();
  const before = await registerOne(admin, headers, incoming, `E2E до сбоя ${stamp}`);

  const abandoned = `E2E брошенный ${stamp}`;
  // A file id that does not exist. The old create → attach → register sequence would by
  // now have persisted a draft; the atomic command must persist nothing at all.
  const failed = await admin.post('/api/v1/docflow/documents/register-incoming', {
    headers,
    data: {
      idempotencyKey: crypto.randomUUID(),
      journalId: incoming,
      typeCode: 'letter',
      subject: abandoned,
      files: [{ fileId: crypto.randomUUID(), kind: 'main' }],
    },
  });
  expect(failed.status(), 'an unknown file is a client error').toBe(400);

  const search = (await (
    await admin.get(
      `/api/v1/docflow/documents?queue=registry&search=${encodeURIComponent(abandoned)}`,
    )
  ).json()) as ListDto;
  expect(search.total, 'no orphan document survived the failure').toBe(0);

  // The next successful registration takes the very next number: the failure consumed none.
  const after = await registerOne(admin, headers, incoming, `E2E после сбоя ${stamp}`);
  expect(seqOf(after.regNumber), 'the sequence is gap-free across the failure').toBe(
    seqOf(before.regNumber) + 1,
  );

  await admin.dispose();
});

test('docflow: register-incoming rejects the wrong journal class and a non-clerk', async () => {
  const admin = await request.newContext({ storageState: STORAGE_STATE, baseURL: API });
  const headers = { ...(await csrfHeaders(admin)), 'content-type': 'application/json' };
  const orders = await journalId(admin, 'orders'); // an internal book

  const mismatch = await admin.post('/api/v1/docflow/documents/register-incoming', {
    headers,
    data: {
      idempotencyKey: crypto.randomUUID(),
      journalId: orders,
      typeCode: 'letter',
      subject: `E2E не тот журнал ${Date.now()}`,
    },
  });
  expect(mismatch.status(), 'an incoming document needs an incoming book').toBe(422);

  // e2e_user is a plain employee: docflow.create, but NOT docflow.register.
  const employee = await apiLogin(E2E_USER.username, E2E_USER.password);
  const employeeHeaders = {
    ...(await csrfHeaders(employee)),
    'content-type': 'application/json',
  };
  const incoming = await journalId(admin, 'incoming');
  const forbidden = await employee.post('/api/v1/docflow/documents/register-incoming', {
    headers: employeeHeaders,
    data: {
      idempotencyKey: crypto.randomUUID(),
      journalId: incoming,
      typeCode: 'letter',
      subject: `E2E без прав ${Date.now()}`,
    },
  });
  expect(forbidden.status(), 'minting a number requires docflow.register').toBe(403);

  await employee.dispose();
  await admin.dispose();
});
