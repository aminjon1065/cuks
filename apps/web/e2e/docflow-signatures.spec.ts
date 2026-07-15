import { createHash, webcrypto } from 'node:crypto';
import { expect, request, test, type APIRequestContext } from '@playwright/test';
import { csrfHeaders } from './support/api';
import { E2E_ADMIN, STORAGE_STATE } from './support/fixtures';

/**
 * Digital signatures (docs/09-security.md §4, docs/modules/11 §6, task 3.5). Drives the
 * real crypto over the API + PostgreSQL + MinIO: the author routes a document through an
 * approval then a signing step; a device certificate is issued from a browser-generated
 * key; the file+requisites payload is signed and verified end-to-end at /verify. Finally,
 * swapping the underlying file (a new version) breaks the file-hash check.
 */
const API = 'http://localhost:3000';

interface DocumentDto {
  id: string;
  status: string;
}
interface FsNodeDto {
  id: string;
}
interface RouteStepDto {
  id: string;
  kind: string;
  status: string;
  canAct: boolean;
}
interface RouteDto {
  status: string;
  steps: RouteStepDto[];
}
interface CertificateDto {
  id: string;
}
interface SignPayloadDto {
  payload: string;
}
interface SignatureDto {
  id: string;
  valid: boolean;
}
interface VerifyResultDto {
  valid: boolean;
  checks: { key: string; ok: boolean }[];
}
interface UserRow {
  id: string;
  username: string;
}

async function json<T>(res: { json: () => Promise<unknown> }): Promise<T> {
  return (await res.json()) as T;
}
async function jsonHeaders(ctx: APIRequestContext): Promise<Record<string, string>> {
  return { ...(await csrfHeaders(ctx)), 'content-type': 'application/json' };
}
async function users(admin: APIRequestContext): Promise<Record<string, string>> {
  const rows = (
    await json<{ items: UserRow[] }>(await admin.get('/api/v1/admin/users?page=1&limit=100'))
  ).items;
  return Object.fromEntries(rows.map((u) => [u.username, u.id]));
}

/** A throwaway ECDSA P-256 signer, mimicking a browser device key. */
async function makeSigner(): Promise<{ spki: string; sign: (payload: string) => Promise<string> }> {
  const pair = (await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
  ])) as webcrypto.CryptoKeyPair;
  const spki = Buffer.from(await webcrypto.subtle.exportKey('spki', pair.publicKey)).toString(
    'base64',
  );
  return {
    spki,
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

/** Upload a file via the real presigned-multipart flow. When `targetNodeId` is set, it
 *  uploads a new version of that node (a file swap). The document only needs a node with
 *  readable bytes; a personal-space file serves for the test. */
async function uploadFile(
  admin: APIRequestContext,
  headers: Record<string, string>,
  content: string,
  targetNodeId?: string,
): Promise<string> {
  const bytes = Buffer.from(content, 'utf8');
  const checksum = createHash('sha256').update(bytes).digest('hex');
  const init = await json<{ uploadId: string; parts: { partNumber: number; url: string }[] }>(
    await admin.post('/api/v1/files/uploads', {
      headers,
      data: {
        space: 'personal',
        name: `sign-${Date.now()}-${Math.round(bytes.length)}.txt`,
        size: bytes.length,
        mime: 'text/plain',
        ...(targetNodeId ? { targetNodeId } : {}),
      },
    }),
  );
  const put = await admin.put(init.parts[0]!.url, { data: bytes });
  expect(put.ok(), `PUT to MinIO ${put.status()}`).toBeTruthy();
  const etag = put.headers()['etag'] ?? '';
  const node = await json<FsNodeDto>(
    await admin.post(`/api/v1/files/uploads/${init.uploadId}/complete`, {
      headers,
      data: { parts: [{ partNumber: 1, eTag: etag }], checksumSha256: checksum },
    }),
  );
  return node.id;
}

test('signatures: route → sign → verify the full outgoing cycle, and a file swap breaks it', async () => {
  const admin = await request.newContext({ storageState: STORAGE_STATE, baseURL: API });
  const headers = await jsonHeaders(admin);
  const byName = await users(admin);

  // The author drafts a document and attaches a main file.
  const doc = await json<DocumentDto>(
    await admin.post('/api/v1/docflow/documents', {
      headers,
      data: { docClass: 'internal', typeCode: 'order', subject: `Приказ на подпись ${Date.now()}` },
    }),
  );
  const fileId = await uploadFile(admin, headers, 'Original document body v1');
  const attach = await admin.post(`/api/v1/docflow/documents/${doc.id}/files`, {
    headers,
    data: { fileId, kind: 'main' },
  });
  expect(attach.ok(), `attach ${attach.status()}`).toBeTruthy();

  // Route: approve → sign (both on the superadmin author — a self-contained full cycle
  // that avoids a second login and its rate-limit under the full suite).
  const adminId = byName[E2E_ADMIN.username];
  const routed = await admin.post(`/api/v1/docflow/documents/${doc.id}/route`, {
    headers,
    data: {
      steps: [
        { order: 1, kind: 'approve', assigneeType: 'user', assigneeId: adminId },
        { order: 2, kind: 'sign', assigneeType: 'user', assigneeId: adminId },
      ],
    },
  });
  expect(routed.ok(), `route ${routed.status()}`).toBeTruthy();

  // Advance the approval so the signing step activates.
  const beforeRoutes = await json<RouteDto[]>(
    await admin.get(`/api/v1/docflow/documents/${doc.id}/routes`),
  );
  const approveStep = beforeRoutes[0]!.steps.find((s) => s.kind === 'approve' && s.canAct)!;
  const approved = await admin.post(
    `/api/v1/docflow/route-steps/${approveStep.id}/actions/approve`,
    { headers, data: {} },
  );
  expect(approved.ok(), `approve ${approved.status()}`).toBeTruthy();

  // Activate a device certificate and sign the server's canonical payload.
  const signer = await makeSigner();
  const cert = await json<CertificateDto>(
    await admin.post('/api/v1/signatures/activate', {
      headers,
      data: { publicKeySpki: signer.spki, deviceLabel: 'e2e device' },
    }),
  );
  const payload = await json<SignPayloadDto>(
    await admin.get(`/api/v1/docflow/documents/${doc.id}/sign-payload`),
  );
  const signature = await signer.sign(payload.payload);

  // A wrong password is rejected (conscious-action step-up).
  const badPw = await admin.post(`/api/v1/docflow/documents/${doc.id}/actions/sign`, {
    headers,
    data: { certificateId: cert.id, signature, password: 'wrong-password' },
  });
  expect(badPw.status(), 'bad password rejected').toBe(403);

  const signed = await admin.post(`/api/v1/docflow/documents/${doc.id}/actions/sign`, {
    headers,
    data: { certificateId: cert.id, signature, password: E2E_ADMIN.password },
  });
  expect(signed.ok(), `sign ${signed.status()}`).toBeTruthy();
  const sigs = await json<SignatureDto[]>(signed);
  expect(sigs).toHaveLength(1);
  expect(sigs[0]!.valid, 'the fresh signature is valid').toBe(true);

  // The completed route moves the document to registration.
  expect(
    (await json<DocumentDto>(await admin.get(`/api/v1/docflow/documents/${doc.id}`))).status,
  ).toBe('pending_registration');

  // /verify confirms every check passes.
  const verify = await json<VerifyResultDto>(await admin.get(`/api/v1/verify/${sigs[0]!.id}`));
  expect(verify.valid, 'verify reports valid').toBe(true);
  expect(
    verify.checks.every((c) => c.ok),
    'all verification checks pass',
  ).toBe(true);

  // The stamped-PDF export is a real PDF.
  const pdf = await admin.post(`/api/v1/docflow/documents/${doc.id}/export-pdf`, {
    headers,
    data: {},
  });
  expect(pdf.ok(), `export ${pdf.status()}`).toBeTruthy();
  expect(pdf.headers()['content-type']).toContain('application/pdf');
  expect((await pdf.body()).subarray(0, 5).toString('latin1')).toBe('%PDF-');

  // Подмена файла: uploading a new version of the same node changes the current bytes,
  // so the signed file hash no longer matches → the signature is no longer valid.
  await uploadFile(admin, headers, 'TAMPERED document body v2', fileId);
  const afterSwap = await json<VerifyResultDto>(await admin.get(`/api/v1/verify/${sigs[0]!.id}`));
  expect(afterSwap.valid, 'a file swap invalidates the signature').toBe(false);
  expect(afterSwap.checks.find((c) => c.key === 'file_hash')?.ok).toBe(false);
  // The cryptographic signature itself is still intact — only the file binding broke.
  expect(afterSwap.checks.find((c) => c.key === 'signature')?.ok).toBe(true);

  await admin.dispose();
});
