import { expect, request, test, type APIRequestContext } from '@playwright/test';
import { apiLogin, csrfHeaders } from './support/api';
import { E2E_USER, E2E_USER2, STORAGE_STATE } from './support/fixtures';

/**
 * Executive-discipline report (docs/modules/11 §5, task 3.9). Drives the real aggregation over the
 * API + PostgreSQL: three resolutions for one executor with known outcomes — on time, late, still
 * open — must land in the right buckets, the report exports as an XLSX, and the endpoint is gated by
 * docflow.reports.view. Executor is e2e_user2, whose only other resolution (a sub-resolution in the
 * resolutions spec) has no due date and so falls outside every period.
 */
const API = 'http://localhost:3000';
const DAY = 86_400_000;

interface DocumentDto {
  id: string;
}
interface ResolutionDto {
  id: string;
}
interface DisciplineRow {
  executorId: string;
  total: number;
  onTime: number;
  late: number;
  notDone: number;
  disciplinePct: number | null;
}
interface DisciplineReport {
  groups: { rows: DisciplineRow[] }[];
  totals: DisciplineRow;
}

const ZERO = { total: 0, onTime: 0, late: 0, notDone: 0 };

/** One executor's buckets from a report (zeros when absent) — the report accumulates across e2e
 *  runs (seed:e2e does not wipe docflow), so the test asserts on the delta it produced. */
function bucketsFor(report: DisciplineReport, executorId: string): typeof ZERO {
  const row = report.groups.flatMap((g) => g.rows).find((r) => r.executorId === executorId);
  if (!row) return ZERO;
  return { total: row.total, onTime: row.onTime, late: row.late, notDone: row.notDone };
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
      data: { docClass: 'incoming', typeCode: 'letter', subject: `Report ${Date.now()}` },
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

/** Issue a resolution and return the newly-created one — the POST echoes the whole tree, so the
 *  new resolution is the id not seen before. */
async function issue(
  admin: APIRequestContext,
  headers: Record<string, string>,
  docId: string,
  executorId: string,
  dueDate: string,
  seen: Set<string>,
): Promise<string> {
  const tree = await json<ResolutionDto[]>(
    await admin.post(`/api/v1/docflow/documents/${docId}/resolutions`, {
      headers,
      data: { text: 'Исполнить', executorId, dueDate },
    }),
  );
  const created = tree.find((r) => !seen.has(r.id))!;
  seen.add(created.id);
  return created.id;
}

test('reports: discipline buckets a period into on time, late and not done, and exports XLSX', async () => {
  const admin = await request.newContext({ storageState: STORAGE_STATE, baseURL: API });
  const headers = await jsonHeaders(admin);
  const executorId = (await users(admin))[E2E_USER2.username]!;
  const docId = await registeredDoc(admin, headers);
  const now = Date.now();
  const seen = new Set<string>();

  const from = new Date(now - 10 * DAY).toISOString();
  const to = new Date(now + 10 * DAY).toISOString();
  const qs = `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  const before = bucketsFor(
    await json<DisciplineReport>(await admin.get(`/api/v1/docflow/reports/discipline?${qs}`)),
    executorId,
  );

  // On time: due in 5 days, completed now (done ≤ due).
  const onTimeId = await issue(
    admin,
    headers,
    docId,
    executorId,
    new Date(now + 5 * DAY).toISOString(),
    seen,
  );
  // Late: due 5 days ago, completed now (done > due).
  const lateId = await issue(
    admin,
    headers,
    docId,
    executorId,
    new Date(now - 5 * DAY).toISOString(),
    seen,
  );
  // Not done: due 3 days ago, left active.
  await issue(admin, headers, docId, executorId, new Date(now - 3 * DAY).toISOString(), seen);

  for (const id of [onTimeId, lateId]) {
    // Bodyless action, but the JSON content-type needs a valid body — send an empty object.
    const done = await admin.post(`/api/v1/docflow/resolutions/${id}/actions/done`, {
      headers,
      data: {},
    });
    expect(done.ok(), `done ${done.status()}`).toBeTruthy();
  }

  const after = bucketsFor(
    await json<DisciplineReport>(await admin.get(`/api/v1/docflow/reports/discipline?${qs}`)),
    executorId,
  );

  // The three new resolutions land in exactly one bucket each (a join fan-out would overcount).
  expect(after.total - before.total, 'total +3').toBe(3);
  expect(after.onTime - before.onTime, 'on time +1').toBe(1);
  expect(after.late - before.late, 'late +1').toBe(1);
  expect(after.notDone - before.notDone, 'not done +1').toBe(1);

  // The XLSX export is a real workbook (ZIP magic bytes) with a spreadsheet content type.
  const xlsx = await admin.get(`/api/v1/docflow/reports/discipline/export?${qs}`);
  expect(xlsx.ok(), `export ${xlsx.status()}`).toBeTruthy();
  expect(xlsx.headers()['content-type']).toContain('spreadsheetml');
  const body = await xlsx.body();
  expect(body.length).toBeGreaterThan(100);
  expect(body[0]).toBe(0x50); // 'P'
  expect(body[1]).toBe(0x4b); // 'K'

  await admin.dispose();
});

test('reports: the discipline report requires docflow.reports.view', async () => {
  const user = await apiLogin(E2E_USER.username, E2E_USER.password);
  const from = new Date(Date.now() - DAY).toISOString();
  const to = new Date(Date.now() + DAY).toISOString();
  const res = await user.get(
    `/api/v1/docflow/reports/discipline?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
  );
  expect(res.status(), 'a plain employee is forbidden').toBe(403);
  await user.dispose();
});
