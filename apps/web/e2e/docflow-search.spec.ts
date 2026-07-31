import { expect, request, test, type APIRequestContext } from '@playwright/test';
import { apiLogin, csrfHeaders } from './support/api';
import { E2E_USER2, STORAGE_STATE } from './support/fixtures';

/**
 * Full-text search over the register (docs/modules/11 §12.13, plan этап 9).
 *
 * Driven over the real API and PostgreSQL, because everything worth testing here IS the SQL:
 * Russian morphology comes from the `russian` text-search configuration, the ДСП rule is a
 * predicate inside the query rather than a filter over its output, and «stable pagination»
 * is a claim about ORDER BY that only a real planner can confirm.
 */
const API = 'http://localhost:3000';

interface DocumentDto {
  id: string;
  subject: string;
  regNumber: string | null;
}
interface Hit {
  id: string;
  subject: string;
  snippet: string | null;
  matchedIn: string[];
}
interface Page {
  items: Hit[];
  total: number;
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
async function search(ctx: APIRequestContext, params: string): Promise<Page> {
  const res = await ctx.get(`/api/v1/docflow/search?${params}`);
  expect(res.ok(), `search ${res.status()} ${await res.text()}`).toBeTruthy();
  return json<Page>(res);
}

async function makeDoc(
  ctx: APIRequestContext,
  headers: Record<string, string>,
  body: Record<string, unknown>,
): Promise<DocumentDto> {
  const res = await ctx.post('/api/v1/docflow/documents', {
    headers,
    data: { docClass: 'internal', typeCode: 'order', ...body },
  });
  expect(res.ok(), `create ${res.status()} ${await res.text()}`).toBeTruthy();
  return json<DocumentDto>(res);
}

test('search: finds a document by an inflected word, and says where the hit came from', async () => {
  const admin = await request.newContext({ storageState: STORAGE_STATE, baseURL: API });
  const headers = await jsonHeaders(admin);
  const stamp = Date.now();
  // A real Russian word, because morphology is the point: an invented stem is not stemmed
  // consistently by snowball, and a token carrying digits is a `numword` that is not stemmed
  // at all. The stamp keeps the document identifiable without joining the searched word.
  const doc = await makeDoc(admin, headers, {
    subject: `О ликвидации последствий наводнения ${stamp}`,
    summary: 'Краткое содержание для проверки поиска',
  });

  // The nominative finds it, and so do the oblique cases — that is the `russian` text-search
  // configuration doing morphology, which a substring match could never do.
  for (const q of ['наводнение', 'наводнению', 'наводнении', 'последствий наводнения']) {
    const page = await search(admin, `q=${encodeURIComponent(q)}&sort=-created_at&page=1&limit=20`);
    expect(
      page.items.map((i) => i.id),
      `«${q}» finds the document`,
    ).toContain(doc.id);
  }

  const hit = (
    await search(admin, `q=${encodeURIComponent('наводнение')}&sort=-created_at&page=1&limit=20`)
  ).items.find((i) => i.id === doc.id)!;
  expect(hit.matchedIn).toContain('document');
  expect(hit.snippet, 'the match is highlighted').toContain('<mark>');

  await admin.dispose();
});

test('search: a registration number is found whole, and ranks first in the palette', async () => {
  const admin = await request.newContext({ storageState: STORAGE_STATE, baseURL: API });
  const headers = await jsonHeaders(admin);
  const stamp = Date.now();
  const doc = await makeDoc(admin, headers, { subject: `Приказ для номера ${stamp}` });
  const journals = await json<{ id: string; code: string }[]>(
    await admin.get('/api/v1/docflow/journals'),
  );
  const registered = await json<DocumentDto>(
    await admin.post(`/api/v1/docflow/documents/${doc.id}/actions/register`, {
      headers,
      data: { journalId: journals.find((j) => j.code === 'orders')!.id },
    }),
  );
  const number = registered.regNumber!;
  expect(number).toBeTruthy();

  // Pasted whole — the tokenizer would never treat «П-2026/0001» as one word, which is why
  // the number gets its own anchored-prefix branch.
  const byNumber = await search(admin, `q=${encodeURIComponent(number)}&page=1&limit=20`);
  const hit = byNumber.items.find((i) => i.id === doc.id);
  expect(hit, `«${number}» finds its own document`).toBeTruthy();
  expect(hit!.matchedIn).toContain('number');

  const quick = await json<{ id: string }[]>(
    await admin.get(`/api/v1/docflow/search/quick?q=${encodeURIComponent(number)}`),
  );
  expect(quick.length, 'the palette shows at most five').toBeLessThanOrEqual(5);
  expect(quick[0]?.id, 'a pasted number lands first').toBe(doc.id);

  await admin.dispose();
});

test('search: a ДСП document is invisible to the undopusked — no row, no count, no snippet', async () => {
  const admin = await request.newContext({ storageState: STORAGE_STATE, baseURL: API });
  const headers = await jsonHeaders(admin);
  const stamp = Date.now();
  const word = `секретслово${stamp}`;
  const doc = await makeDoc(admin, headers, {
    subject: `ДСП ${word}`,
    summary: `Тело содержит ${word} целиком`,
    confidentiality: 'dsp',
  });

  const mine = await search(admin, `q=${encodeURIComponent(word)}&page=1&limit=20`);
  expect(
    mine.items.map((i) => i.id),
    'the author finds their own ДСП',
  ).toContain(doc.id);

  // e2e_user2 has no docflow.confidential.view. Three separate disclosures are checked, not
  // one: the row, the total, and the snippet — a search that filtered AFTER the query would
  // still have leaked the count (AC-SED-06).
  const other = await apiLogin(E2E_USER2.username, E2E_USER2.password);
  const theirs = await json<Page>(
    await other.get(`/api/v1/docflow/search?q=${encodeURIComponent(word)}&page=1&limit=20`),
  );
  expect(theirs.items.map((i) => i.id)).not.toContain(doc.id);
  expect(theirs.total, 'the count does not admit it exists either').toBe(0);
  expect(JSON.stringify(theirs)).not.toContain(word.toUpperCase().slice(0, 6));

  const palette = await json<{ id: string }[]>(
    await other.get(`/api/v1/docflow/search/quick?q=${encodeURIComponent(word)}`),
  );
  expect(
    palette.map((h) => h.id),
    'Cmd+K uses the same policy',
  ).not.toContain(doc.id);

  // And the card itself stays a 404, so the search is not a way to learn an id.
  expect((await other.get(`/api/v1/docflow/documents/${doc.id}`)).status()).toBe(404);

  await Promise.all([admin.dispose(), other.dispose()]);
});

test('search: pagination is stable across pages, and a bad sort is refused', async () => {
  const admin = await request.newContext({ storageState: STORAGE_STATE, baseURL: API });
  const headers = await jsonHeaders(admin);
  const stamp = Date.now();
  const word = `пагинация${stamp}`;
  // Created in one burst on purpose: without a unique tie-breaker these share a timestamp and
  // the two pages would be free to overlap.
  for (let i = 0; i < 7; i++) {
    await makeDoc(admin, headers, { subject: `${word} документ ${i}` });
  }

  const params = `q=${encodeURIComponent(word)}&sort=-created_at`;
  const first = await search(admin, `${params}&page=1&limit=3`);
  const second = await search(admin, `${params}&page=2&limit=3`);
  expect(first.total).toBeGreaterThanOrEqual(7);
  const overlap = first.items.filter((a) => second.items.some((b) => b.id === a.id));
  expect(overlap, 'no document appears on both pages').toEqual([]);

  for (const bad of ['password', '(select 1)', 'created_at; drop table app.documents']) {
    const res = await admin.get(
      `/api/v1/docflow/search?q=${encodeURIComponent(word)}&sort=${encodeURIComponent(bad)}`,
    );
    expect(res.status(), `sort=${bad}`).toBe(400);
    expect((await json<ErrorBody>(res)).error?.code).toBe('common.request.validation_failed');
  }

  await admin.dispose();
});
