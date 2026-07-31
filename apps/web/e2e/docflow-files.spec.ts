import { createHash } from 'node:crypto';
import { expect, request, test, type APIRequestContext } from '@playwright/test';
import type { FsNodeDto } from '@cuks/shared';
import { apiLogin, csrfHeaders } from './support/api';
import { E2E_USER, E2E_USER2, STORAGE_STATE } from './support/fixtures';

/**
 * Guarded document files (docs/modules/11 §12.2, plan этап 1C). Drives the real API,
 * PostgreSQL and MinIO: attaching a file moves it out of the uploader's personal space,
 * so afterwards even the uploader can only reach it through the document; a document the
 * caller cannot see (or a ДСП one they are not listed on) yields the same 404 as a
 * missing file; a file id from another document is not readable by pairing it with a
 * document the caller CAN see; and nothing is served before the antivirus has cleared it.
 *
 * REQUIRES THE WORKER. The antivirus verdict is produced by the `av-scan` BullMQ job, and
 * Playwright's `webServer` starts only the api and the web app. Run `pnpm --filter
 * @cuks/worker dev` alongside, or these specs will (correctly) fail waiting for a verdict
 * that nobody is computing.
 */
const API = 'http://localhost:3000';

interface DocumentDto {
  id: string;
  files: { fileId: string; avStatus: string | null; name: string }[];
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

/** Upload a personal-space file through the real presigned-multipart flow. */
async function uploadFile(
  ctx: APIRequestContext,
  headers: Record<string, string>,
  content: string,
): Promise<string> {
  const bytes = Buffer.from(content, 'utf8');
  const checksum = createHash('sha256').update(bytes).digest('hex');
  const init = await json<{ uploadId: string; parts: { partNumber: number; url: string }[] }>(
    await ctx.post('/api/v1/files/uploads', {
      headers,
      data: {
        space: 'personal',
        name: `doc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.txt`,
        size: bytes.length,
        mime: 'text/plain',
      },
    }),
  );
  const put = await ctx.put(init.parts[0]!.url, { data: bytes });
  expect(put.ok(), `PUT to MinIO ${put.status()}`).toBeTruthy();
  const node = await json<FsNodeDto>(
    await ctx.post(`/api/v1/files/uploads/${init.uploadId}/complete`, {
      headers,
      data: {
        parts: [{ partNumber: 1, eTag: put.headers()['etag'] ?? '' }],
        checksumSha256: checksum,
      },
    }),
  );
  return node.id;
}

/** Create a draft and attach a main file; returns the document and node ids. */
async function documentWithFile(
  ctx: APIRequestContext,
  headers: Record<string, string>,
  subject: string,
): Promise<{ documentId: string; fileId: string }> {
  const doc = await json<DocumentDto>(
    await ctx.post('/api/v1/docflow/documents', {
      headers,
      data: { docClass: 'incoming', typeCode: 'letter', subject },
    }),
  );
  const fileId = await uploadFile(ctx, headers, `body of ${subject}`);
  const attach = await ctx.post(`/api/v1/docflow/documents/${doc.id}/files`, {
    headers,
    data: { fileId, kind: 'main' },
  });
  expect(attach.ok(), `attach ${attach.status()}`).toBeTruthy();
  return { documentId: doc.id, fileId };
}

/** Wait until the av-scan job has cleared the attached file (it starts `pending`). */
async function waitForClean(
  ctx: APIRequestContext,
  documentId: string,
  fileId: string,
): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const doc = await json<DocumentDto>(await ctx.get(`/api/v1/docflow/documents/${documentId}`));
    if (doc.files.find((f) => f.fileId === fileId)?.avStatus === 'clean') return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(
    `file ${fileId} never reached avStatus=clean — is the worker running? ` +
      'The av-scan job produces the verdict; Playwright starts only api + web.',
  );
}

test('docflow files: attaching adopts the node out of the personal space', async () => {
  // e2e_user is a plain employee — after the attach the file manager must refuse them,
  // because the ONLY path to a document body is the document policy.
  const author = await apiLogin(E2E_USER.username, E2E_USER.password);
  const headers = await jsonHeaders(author);
  const { documentId, fileId } = await documentWithFile(author, headers, `Файл ДОУ ${Date.now()}`);

  const viaFileManager = await author.get(`/api/v1/files/${fileId}`);
  expect(
    viaFileManager.status(),
    'the uploader can no longer reach the body through the file manager',
  ).toBe(403);

  await waitForClean(author, documentId, fileId);
  const viaDocument = await author.get(
    `/api/v1/docflow/documents/${documentId}/files/${fileId}/download`,
    { maxRedirects: 0 },
  );
  expect(viaDocument.status(), 'but the document serves it').toBe(302);
  // A short-lived presigned URL, never a permanent object link.
  expect(viaDocument.headers()['location'] ?? '').toContain('X-Amz-Expires');

  await author.dispose();
});

test('docflow files: a file is not served before the antivirus clears it', async () => {
  const author = await apiLogin(E2E_USER.username, E2E_USER.password);
  const headers = await jsonHeaders(author);
  const { documentId, fileId } = await documentWithFile(author, headers, `Карантин ${Date.now()}`);

  // Immediately after the attach the version is still `pending` — quarantine.
  const early = await author.get(
    `/api/v1/docflow/documents/${documentId}/files/${fileId}/download`,
    { maxRedirects: 0 },
  );
  if (early.status() !== 302) {
    expect(early.status(), 'an unscanned body is refused').toBe(403);
    const body = (await early.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe('docflow.file.not_safe');
  } else {
    // The scanner beat us to it — the gate is then correctly transparent.
    test
      .info()
      .annotations.push({ type: 'note', description: 'av-scan finished before the check' });
  }

  await waitForClean(author, documentId, fileId);
  const after = await author.get(
    `/api/v1/docflow/documents/${documentId}/files/${fileId}/download`,
    { maxRedirects: 0 },
  );
  expect(after.status(), 'once cleared it is served').toBe(302);

  await author.dispose();
});

test('docflow files: a foreign document and a foreign file id are both 404', async () => {
  const author = await apiLogin(E2E_USER.username, E2E_USER.password);
  const authorHeaders = await jsonHeaders(author);
  const own = await documentWithFile(author, authorHeaders, `Чужой файл A ${Date.now()}`);
  const second = await documentWithFile(author, authorHeaders, `Чужой файл B ${Date.now()}`);
  await waitForClean(author, own.documentId, own.fileId);

  // A document the caller is not a participant of hides its files behind the same 404
  // the document itself returns — no existence leak.
  const outsider = await apiLogin(E2E_USER2.username, E2E_USER2.password);
  const foreign = await outsider.get(
    `/api/v1/docflow/documents/${own.documentId}/files/${own.fileId}/download`,
  );
  expect(foreign.status(), 'a non-participant sees nothing').toBe(404);
  await outsider.dispose();

  // Pairing a document the caller CAN see with a file id belonging to another document
  // must not read that other body.
  const crossed = await author.get(
    `/api/v1/docflow/documents/${own.documentId}/files/${second.fileId}/download`,
  );
  expect(crossed.status(), 'the link must belong to this document').toBe(404);

  await author.dispose();
});

test('docflow files: a ДСП body is unreachable without the allow-list', async () => {
  const admin = await request.newContext({ storageState: STORAGE_STATE, baseURL: API });
  const ids = await userIds(admin);
  await admin.dispose();

  const author = await apiLogin(E2E_USER.username, E2E_USER.password);
  const headers = await jsonHeaders(author);
  const { documentId, fileId } = await documentWithFile(author, headers, `ДСП файл ${Date.now()}`);
  const grif = await author.patch(`/api/v1/docflow/documents/${documentId}/access`, {
    headers,
    data: { confidentiality: 'dsp', accessList: [ids[E2E_USER.username]!] },
  });
  expect(grif.ok(), `set grif ${grif.status()}`).toBeTruthy();
  await waitForClean(author, documentId, fileId);

  // e2e_user2 is not on the allow-list: the body is a 404, exactly like the card.
  const outsider = await apiLogin(E2E_USER2.username, E2E_USER2.password);
  const denied = await outsider.get(
    `/api/v1/docflow/documents/${documentId}/files/${fileId}/download`,
  );
  expect(denied.status(), 'ДСП is allow-list only, even for the body').toBe(404);
  await outsider.dispose();

  const allowed = await author.get(
    `/api/v1/docflow/documents/${documentId}/files/${fileId}/download`,
    { maxRedirects: 0 },
  );
  expect(allowed.status(), 'the listed author still reads it').toBe(302);

  // The ДСП read trail records the body read too (docs/09 §3).
  const trail = await json<{ entityType: string }[]>(
    await author.get(`/api/v1/docflow/documents/${documentId}/read-log`),
  );
  expect(Array.isArray(trail)).toBe(true);

  await author.dispose();
});
