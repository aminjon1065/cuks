import { expect, request, test, type APIRequestContext } from '@playwright/test';
import { csrfHeaders } from './support/api';
import { STORAGE_STATE } from './support/fixtures';

/**
 * Versioned document templates and structured content (docs/modules/11 §12.7, plan этап 3).
 * Drives the real API + PostgreSQL: a body outside the content allow-list is refused on
 * write, a published version is frozen, instantiating records the exact version it came
 * from, and template variables are substituted from a fixed context — never evaluated.
 */
const API = 'http://localhost:3000';

interface TemplateDto {
  id: string;
  code: string;
  publishedVersion: number | null;
  versions: {
    version: number;
    isPublished: boolean;
    variables: { known: string[]; unknown: string[] };
  }[];
}
interface DocumentDto {
  id: string;
  subject: string;
  templateVersionId: string | null;
  content: { type: string; content?: unknown[] } | null;
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
const para = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
const body = (content: unknown[]) => ({ type: 'doc', content });

async function createTemplate(
  ctx: APIRequestContext,
  headers: Record<string, string>,
): Promise<TemplateDto> {
  const res = await ctx.post('/api/v1/docflow/document-templates', {
    headers,
    data: {
      code: `tpl-${Date.now()}-${Math.round(Math.random() * 1e6)}`,
      name: 'Служебная записка',
      docClass: 'internal',
      documentTypeCode: 'memo',
    },
  });
  expect(res.ok(), `create template ${res.status()}`).toBeTruthy();
  return json<TemplateDto>(res);
}

test('templates: a body outside the allow-list is refused on write', async () => {
  const admin = await request.newContext({ storageState: STORAGE_STATE, baseURL: API });
  const headers = await jsonHeaders(admin);
  const template = await createTemplate(admin, headers);

  // Storing first and sanitising at render would leave every future reader — export,
  // search, an integration — one forgotten call away from a stored-XSS bug.
  for (const bad of [
    body([{ type: 'iframe' }]),
    body([{ type: 'paragraph', attrs: { onclick: 'alert(1)' } }]),
    body([
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'x', marks: [{ type: 'link', attrs: { href: 'javascript:x' } }] },
        ],
      },
    ]),
  ]) {
    const res = await admin.post(`/api/v1/docflow/document-templates/${template.id}/versions`, {
      headers,
      data: { content: bad },
    });
    expect(res.status(), `refused: ${JSON.stringify(bad).slice(0, 60)}`).toBe(400);
  }

  // The same allow-list guards a document's own body, not just a template's.
  const doc = await admin.post('/api/v1/docflow/documents', {
    headers,
    data: {
      docClass: 'internal',
      typeCode: 'memo',
      subject: `Опасный контент ${Date.now()}`,
      content: body([{ type: 'script' }]),
    },
  });
  expect(doc.status(), 'a document body is validated the same way').toBe(400);

  await admin.dispose();
});

test('templates: a published version is frozen and instantiating records it', async () => {
  const admin = await request.newContext({ storageState: STORAGE_STATE, baseURL: API });
  const headers = await jsonHeaders(admin);
  const template = await createTemplate(admin, headers);

  const v1 = await admin.post(`/api/v1/docflow/document-templates/${template.id}/versions`, {
    headers,
    data: {
      content: body([para('Тема: {{document.subject}}'), para('Подготовил: {{author.shortName}}')]),
    },
  });
  expect(v1.ok(), `add version ${v1.status()}`).toBeTruthy();

  // A draft version cannot be instantiated — its body is still being written.
  const early = await admin.post(
    `/api/v1/docflow/document-templates/${template.id}/actions/instantiate`,
    { headers, data: { subject: 'Рано' } },
  );
  expect(early.status()).toBe(422);
  expect((await json<ErrorBody>(early)).error?.code).toBe('docflow.template.no_published_version');

  const published = await json<TemplateDto>(
    await admin.post(
      `/api/v1/docflow/document-templates/${template.id}/versions/1/actions/publish`,
      { headers, data: {} },
    ),
  );
  expect(published.publishedVersion).toBe(1);
  expect(published.versions[0]!.variables.known).toContain('document.subject');

  // Publishing the same version twice is a conflict, not a silent no-op.
  const again = await admin.post(
    `/api/v1/docflow/document-templates/${template.id}/versions/1/actions/publish`,
    { headers, data: {} },
  );
  expect(again.status()).toBe(409);

  const created = await admin.post(
    `/api/v1/docflow/document-templates/${template.id}/actions/instantiate`,
    { headers, data: { subject: 'О порядке дежурства' } },
  );
  expect(created.ok(), `instantiate ${created.status()}`).toBeTruthy();
  const { documentId } = await json<{ documentId: string }>(created);
  const doc = await json<DocumentDto>(await admin.get(`/api/v1/docflow/documents/${documentId}`));

  // The document records WHICH version produced it, so the result stays reproducible.
  expect(doc.templateVersionId, 'the source version is recorded').toBeTruthy();
  expect(JSON.stringify(doc.content)).toContain('Тема: О порядке дежурства');
  expect(
    JSON.stringify(doc.content),
    'the placeholder was substituted, not left raw',
  ).not.toContain('{{document.subject}}');

  // Version 2 supersedes v1 for NEW documents; the already-created one is untouched.
  await admin.post(`/api/v1/docflow/document-templates/${template.id}/versions`, {
    headers,
    data: { content: body([para('Совершенно другой текст')]) },
  });
  await admin.post(`/api/v1/docflow/document-templates/${template.id}/versions/2/actions/publish`, {
    headers,
    data: {},
  });
  const unchanged = await json<DocumentDto>(
    await admin.get(`/api/v1/docflow/documents/${documentId}`),
  );
  expect(
    JSON.stringify(unchanged.content),
    'publishing v2 did not rewrite the v1 document',
  ).toContain('Тема: О порядке дежурства');

  await admin.dispose();
});

test('templates: unknown variables are left verbatim, never resolved', async () => {
  const admin = await request.newContext({ storageState: STORAGE_STATE, baseURL: API });
  const headers = await jsonHeaders(admin);
  const template = await createTemplate(admin, headers);

  await admin.post(`/api/v1/docflow/document-templates/${template.id}/versions`, {
    headers,
    // The vectors: a namespace that exists but a field that must never be exposed, and a
    // shape that would only render if placeholders were evaluated rather than looked up.
    data: {
      content: body([para('{{author.totpSecret}} {{user.passwordHash}} {{1+1}} {{org.name}}')]),
    },
  });
  const detail = await json<TemplateDto>(
    await admin.get(`/api/v1/docflow/document-templates/${template.id}`),
  );
  expect(detail.versions[0]!.variables.unknown).toEqual(
    expect.arrayContaining(['author.totpSecret', 'user.passwordHash']),
  );
  expect(detail.versions[0]!.variables.known).toEqual(['org.name']);

  await admin.post(`/api/v1/docflow/document-templates/${template.id}/versions/1/actions/publish`, {
    headers,
    data: {},
  });
  const { documentId } = await json<{ documentId: string }>(
    await admin.post(`/api/v1/docflow/document-templates/${template.id}/actions/instantiate`, {
      headers,
      data: { subject: `Переменные ${Date.now()}` },
    }),
  );
  const doc = await json<DocumentDto>(await admin.get(`/api/v1/docflow/documents/${documentId}`));
  const rendered = JSON.stringify(doc.content);
  expect(rendered, 'an unknown placeholder stays visible instead of resolving').toContain(
    '{{author.totpSecret}}',
  );
  expect(rendered).toContain('{{1+1}}');

  await admin.dispose();
});

test('templates: managing them needs the chancellery right', async () => {
  const admin = await request.newContext({ storageState: STORAGE_STATE, baseURL: API });
  const headers = await jsonHeaders(admin);
  const template = await createTemplate(admin, headers);

  // A retired template disappears from the picker and cannot produce new documents.
  await admin.post(`/api/v1/docflow/document-templates/${template.id}/versions`, {
    headers,
    data: { content: body([para('Текст')]) },
  });
  await admin.post(`/api/v1/docflow/document-templates/${template.id}/versions/1/actions/publish`, {
    headers,
    data: {},
  });
  await admin.post(`/api/v1/docflow/document-templates/${template.id}/actions/deactivate`, {
    headers,
    data: {},
  });
  const afterRetire = await admin.post(
    `/api/v1/docflow/document-templates/${template.id}/actions/instantiate`,
    { headers, data: { subject: 'После снятия' } },
  );
  expect(afterRetire.status()).toBe(422);
  expect((await json<ErrorBody>(afterRetire)).error?.code).toBe('docflow.template.inactive');

  await admin.dispose();
});
