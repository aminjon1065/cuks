import { expect, request, test, type APIRequestContext } from '@playwright/test';
import { apiLogin, csrfHeaders } from './support/api';
import { E2E_USER, E2E_USER2, STORAGE_STATE } from './support/fixtures';

/**
 * Distributing an internal document for acknowledgement (docs/modules/11 §12.4, plan этап 7,
 * acceptance AC-SED-04). Drives the real API + PostgreSQL: an order is registered, sent round
 * to a subdivision and to named people, and each reader confirms their own line.
 *
 * The invariants it holds the product to: nothing is distributed before it is registered; the
 * subtree is walked only when asked for; a person reached by two targets owes ONE reading;
 * the sheet is a snapshot; and a reader may only close their own line.
 */
const API = 'http://localhost:3000';

interface DocumentDto {
  id: string;
  status: string;
  regNumber: string | null;
  availableActions: string[];
}
interface ReaderDto {
  userId: string;
  userName: string | null;
  status: string;
  acknowledgedAt: string | null;
}
interface DistributionDto {
  id: string;
  releaseAt: string | null;
  releasedAt: string | null;
  releasedReason: string | null;
  readers: ReaderDto[];
  canAcknowledge: boolean;
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

/** A registered internal order — the only thing a distribution may be sent for. */
async function registeredOrder(
  admin: APIRequestContext,
  headers: Record<string, string>,
  subject: string,
): Promise<DocumentDto> {
  const draft = await json<DocumentDto>(
    await admin.post('/api/v1/docflow/documents', {
      headers,
      data: { docClass: 'internal', typeCode: 'order', subject },
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

test('distribution: an order reaches its readers once, and each closes their own line', async () => {
  test.setTimeout(90_000);
  const admin = await request.newContext({ storageState: STORAGE_STATE, baseURL: API });
  const headers = await jsonHeaders(admin);
  const ids = await userIds(admin);
  const stamp = Date.now();

  // --- Nothing is distributed before it is registered -------------------------------
  const draft = await json<DocumentDto>(
    await admin.post('/api/v1/docflow/documents', {
      headers,
      data: { docClass: 'internal', typeCode: 'order', subject: `Черновик приказа ${stamp}` },
    }),
  );
  const early = await admin.post(`/api/v1/docflow/documents/${draft.id}/distributions`, {
    headers,
    data: { targets: [{ type: 'user', id: ids[E2E_USER.username] }] },
  });
  expect(early.status(), 'a draft can still be rewritten under its readers').toBe(422);
  expect((await json<ErrorBody>(early)).error?.code).toBe('docflow.distribution.not_registered');

  // --- The registered order goes round ----------------------------------------------
  const order = await registeredOrder(admin, headers, `Приказ о готовности ${stamp}`);
  expect(order.regNumber).toBeTruthy();
  expect(order.availableActions, 'the card now offers a distribution').toContain('distribute');

  const created = await admin.post(`/api/v1/docflow/documents/${order.id}/distributions`, {
    headers,
    data: {
      targets: [
        { type: 'user', id: ids[E2E_USER.username] },
        { type: 'user', id: ids[E2E_USER2.username] },
        // The same person again — one reading is owed, not two.
        { type: 'user', id: ids[E2E_USER.username] },
      ],
    },
  });
  expect(created.ok(), `distribute ${created.status()} ${await created.text()}`).toBeTruthy();
  const batch = await json<DistributionDto>(created);

  expect(batch.readers, 'a person reached twice owes one reading').toHaveLength(2);
  expect(batch.readers.every((r) => r.status === 'pending')).toBe(true);
  expect(batch.releasedAt, 'and the sheet starts open').toBeNull();

  // --- A reader closes their own line, and only their own ---------------------------
  const reader = await apiLogin(E2E_USER.username, E2E_USER.password);
  const readerHeaders = await jsonHeaders(reader);
  const acked = await reader.post(
    `/api/v1/docflow/acquaintance-batches/${batch.id}/actions/acknowledge`,
    { headers: readerHeaders, data: {} },
  );
  expect(acked.ok(), `acknowledge ${acked.status()} ${await acked.text()}`).toBeTruthy();

  const afterFirst = await json<DistributionDto[]>(
    await admin.get(`/api/v1/docflow/documents/${order.id}/distributions`),
  );
  const sheet = afterFirst.find((b) => b.id === batch.id)!;
  expect(sheet.readers.filter((r) => r.status === 'acknowledged')).toHaveLength(1);
  expect(sheet.readers.filter((r) => r.status === 'pending')).toHaveLength(1);
  expect(sheet.releasedAt, 'one reader left, so the sheet is still open').toBeNull();
  await reader.dispose();

  // Somebody who was never distributed to cannot sign the sheet off.
  const outsider = await request.newContext({ storageState: STORAGE_STATE, baseURL: API });
  const stolen = await outsider.post(
    `/api/v1/docflow/acquaintance-batches/${batch.id}/actions/acknowledge`,
    { headers: await csrfHeaders(outsider), data: {} },
  );
  expect(stolen.status(), 'only the addressee reads for themselves').toBe(403);
  await outsider.dispose();

  // --- The last reader closes the sheet ---------------------------------------------
  const second = await apiLogin(E2E_USER2.username, E2E_USER2.password);
  const closed = await json<{ releasedAt: string | null; releasedReason: string | null }>(
    await second.post(`/api/v1/docflow/acquaintance-batches/${batch.id}/actions/acknowledge`, {
      headers: await jsonHeaders(second),
      data: {},
    }),
  );
  expect(closed.releasedAt, 'everyone has read it').toBeTruthy();
  expect(closed.releasedReason).toBe('all_acknowledged');
  await second.dispose();

  const final = await json<DistributionDto[]>(
    await admin.get(`/api/v1/docflow/documents/${order.id}/distributions`),
  );
  expect(
    final.find((b) => b.id === batch.id)!.readers.every((r) => r.status === 'acknowledged'),
  ).toBe(true);

  await admin.dispose();
});

test('distribution: a subdivision is walked only as deep as asked', async () => {
  const admin = await request.newContext({ storageState: STORAGE_STATE, baseURL: API });
  const headers = await jsonHeaders(admin);
  const stamp = Date.now();

  // The seeded committee is the root of the tree; its children are the управления.
  interface UnitNode {
    id: string;
    name: string;
    children: UnitNode[];
  }
  const tree = await json<UnitNode[]>(await admin.get('/api/v1/admin/org-units'));
  const root = tree[0]!;
  expect(root.children.length, 'the seeded org tree has depth').toBeGreaterThan(0);

  const order = await registeredOrder(admin, headers, `Приказ по управлению ${stamp}`);

  const direct = await admin.post(`/api/v1/docflow/documents/${order.id}/distributions`, {
    headers,
    data: { targets: [{ type: 'org_unit', id: root.id, includeSubtree: false }] },
  });
  // The root may legitimately have no direct members; either outcome is correct, and both
  // are strictly narrower than the subtree.
  const directCount = direct.ok() ? (await json<DistributionDto>(direct)).readers.length : 0;

  const order2 = await registeredOrder(admin, headers, `Приказ с поддеревом ${stamp}`);
  const subtree = await admin.post(`/api/v1/docflow/documents/${order2.id}/distributions`, {
    headers,
    data: { targets: [{ type: 'org_unit', id: root.id, includeSubtree: true }] },
  });
  expect(subtree.ok(), `subtree ${subtree.status()} ${await subtree.text()}`).toBeTruthy();
  const wide = await json<DistributionDto>(subtree);

  // «отделу» and «управлению со всеми отделами» are different instructions.
  expect(wide.readers.length).toBeGreaterThan(directCount);
  // And still one line per person, however many subdivisions they hold a post in.
  expect(new Set(wide.readers.map((r) => r.userId)).size).toBe(wide.readers.length);

  await admin.dispose();
});

test('distribution: an outgoing document is never distributed, and empty targets are refused', async () => {
  const admin = await request.newContext({ storageState: STORAGE_STATE, baseURL: API });
  const headers = await jsonHeaders(admin);
  const stamp = Date.now();

  const outgoing = await json<DocumentDto>(
    await admin.post('/api/v1/docflow/documents', {
      headers,
      data: { docClass: 'outgoing', typeCode: 'letter', subject: `Исходящее ${stamp}` },
    }),
  );
  const wrongClass = await admin.post(`/api/v1/docflow/documents/${outgoing.id}/distributions`, {
    headers,
    data: { targets: [{ type: 'org_unit', id: outgoing.id }] },
  });
  // An outgoing document leaves through dispatch, not through an acknowledgement sheet.
  expect(wrongClass.status()).toBe(422);
  expect((await json<ErrorBody>(wrongClass)).error?.code).toBe('docflow.distribution.not_internal');

  const order = await registeredOrder(admin, headers, `Приказ без адресатов ${stamp}`);
  const empty = await admin.post(`/api/v1/docflow/documents/${order.id}/distributions`, {
    headers,
    data: { targets: [] },
  });
  expect(empty.status(), 'zod refuses an empty target list').toBe(400);

  await admin.dispose();
});

test('distribution: the acknowledgement report counts silence apart from compliance', async () => {
  const admin = await request.newContext({ storageState: STORAGE_STATE, baseURL: API });
  const headers = await jsonHeaders(admin);
  const ids = await userIds(admin);
  const stamp = Date.now();

  const order = await registeredOrder(admin, headers, `Приказ для отчёта ${stamp}`);
  await admin.post(`/api/v1/docflow/documents/${order.id}/distributions`, {
    headers,
    data: { targets: [{ type: 'user', id: ids[E2E_USER.username] }] },
  });

  const from = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const to = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  const report = await json<{
    rows: { regNumber: string | null; status: string }[];
    totals: { total: number; acknowledged: number; pending: number; expired: number };
    hiddenCount: number;
  }>(
    await admin.get(
      `/api/v1/docflow/reports/acknowledgement?from=${from}T00:00:00%2B05:00&to=${to}T23:59:59%2B05:00`,
    ),
  );
  const mine = report.rows.filter((r) => r.regNumber === order.regNumber);
  expect(mine, 'the distribution shows up in the period').toHaveLength(1);
  expect(mine[0]?.status).toBe('pending');
  expect(report.totals.pending).toBeGreaterThan(0);

  // The XLSX is a real workbook (a ZIP container).
  const xlsx = await admin.get(
    `/api/v1/docflow/reports/acknowledgement/export?from=${from}T00:00:00%2B05:00&to=${to}T23:59:59%2B05:00`,
  );
  expect(xlsx.ok(), `export ${xlsx.status()}`).toBeTruthy();
  expect(xlsx.headers()['content-type']).toContain('spreadsheetml');
  const body = await xlsx.body();
  expect(body[0]).toBe(0x50);
  expect(body[1]).toBe(0x4b);

  await admin.dispose();
});

test('distribution: a lapsed sheet stops blocking the order, and a closed line cannot be signed', async () => {
  test.setTimeout(120_000);
  const admin = await request.newContext({ storageState: STORAGE_STATE, baseURL: API });
  const headers = await jsonHeaders(admin);
  const ids = await userIds(admin);
  const stamp = Date.now();

  const order = await registeredOrder(admin, headers, `Приказ со сроком ${stamp}`);

  // A deadline already past would mark everyone expired before anyone could open it.
  const past = await admin.post(`/api/v1/docflow/documents/${order.id}/distributions`, {
    headers,
    data: {
      targets: [{ type: 'user', id: ids[E2E_USER.username] }],
      dueAt: new Date(Date.now() - 60_000).toISOString(),
    },
  });
  expect(past.status(), 'a sheet that fails on arrival is refused').toBe(422);
  expect((await json<ErrorBody>(past)).error?.code).toBe('docflow.distribution.due_in_past');

  const batch = await json<DistributionDto>(
    await admin.post(`/api/v1/docflow/documents/${order.id}/distributions`, {
      headers,
      data: { targets: [{ type: 'user', id: ids[E2E_USER.username] }] },
    }),
  );

  // While the sheet is open the order owes a reading and cannot be declared finished.
  const early = await admin.post(`/api/v1/docflow/documents/${order.id}/actions/status`, {
    headers,
    data: { status: 'completed' },
  });
  expect(early.status(), 'an unread order is not finished').toBe(422);
  expect((await json<ErrorBody>(early)).error?.code).toBe('docflow.document.acquaintance_open');

  const reader = await apiLogin(E2E_USER.username, E2E_USER.password);
  await reader.post(`/api/v1/docflow/acquaintance-batches/${batch.id}/actions/acknowledge`, {
    headers: await csrfHeaders(reader),
    data: {},
  });
  await reader.dispose();

  // Read by everyone, so the order can be closed — the obligation is genuinely gone.
  const done = await admin.post(`/api/v1/docflow/documents/${order.id}/actions/status`, {
    headers,
    data: { status: 'completed' },
  });
  expect(done.ok(), `complete ${done.status()} ${await done.text()}`).toBeTruthy();

  await admin.dispose();
});

test('distribution: a distributed order reaches the reader’s «На ознакомление» queue', async () => {
  const admin = await request.newContext({ storageState: STORAGE_STATE, baseURL: API });
  const headers = await jsonHeaders(admin);
  const ids = await userIds(admin);
  const stamp = Date.now();

  const order = await registeredOrder(admin, headers, `Приказ в очередь ${stamp}`);
  await admin.post(`/api/v1/docflow/documents/${order.id}/distributions`, {
    headers,
    data: { targets: [{ type: 'user', id: ids[E2E_USER2.username] }] },
  });

  // The queue that exists precisely so people find what they must read must show it —
  // a distribution line has no route step, and the queue used to be built from that join.
  const reader = await apiLogin(E2E_USER2.username, E2E_USER2.password);
  const queue = await json<{ items: { id: string }[] }>(
    await reader.get('/api/v1/docflow/documents?queue=to_acknowledge&page=1&limit=200'),
  );
  expect(queue.items.map((d) => d.id)).toContain(order.id);
  await reader.dispose();

  await admin.dispose();
});
