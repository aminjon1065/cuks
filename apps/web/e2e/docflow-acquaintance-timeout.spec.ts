import { expect, request, test } from '@playwright/test';
import { apiLogin, csrfHeaders } from './support/api';
import { E2E_USER, E2E_USER2, STORAGE_STATE } from './support/fixtures';

/**
 * The gate opens by itself when its timeout passes — and a lapsed deadline is NOT a reading
 * (docs/modules/11 §12.3, plan этап 5). The reader who never answered is recorded
 * `expired`, so no report can present the timeout as everyone having read the document,
 * while the executors do get their instruction.
 *
 * Opt-in, because the default gate is four hours and neither the server clock nor the
 * 60-second sweep can be faked from the browser. Run the api with a short gate and set the
 * flag this spec looks for:
 *
 *   DOCFLOW_ACQUAINTANCE_GATE_HOURS=0.005 pnpm --filter @cuks/api dev
 *   GATE_TIMEOUT_E2E=1 pnpm --filter @cuks/web exec playwright test docflow-acquaintance-timeout
 */
const API = 'http://localhost:3000';
const ENABLED = !!process.env.GATE_TIMEOUT_E2E;

interface GateDto {
  id: string;
  releasedAt: string | null;
  releasedReason: string | null;
  lines: { userId: string; status: string }[];
}
interface ProposalDto {
  id: string;
  status: string;
  gate: GateDto | null;
}

async function json<T>(res: { json: () => Promise<unknown> }): Promise<T> {
  return (await res.json()) as T;
}

test.describe('acquaintance gate timeout', () => {
  test.skip(!ENABLED, 'needs an api started with a short DOCFLOW_ACQUAINTANCE_GATE_HOURS');
  // Up to a minute of sweep latency on top of the gate itself.
  test.setTimeout(180_000);

  test('a timeout opens the gate once and marks the silent reader expired', async () => {
    const admin = await request.newContext({ storageState: STORAGE_STATE, baseURL: API });
    const headers = { ...(await csrfHeaders(admin)), 'content-type': 'application/json' };
    const me = (await json<{ id: string }>(await admin.get('/api/auth/me'))).id;
    const users = (
      await json<{ items: { id: string; username: string }[] }>(
        await admin.get('/api/v1/admin/users?page=1&limit=100'),
      )
    ).items;
    const idOf = (username: string) => users.find((u) => u.username === username)!.id;

    const journals = await json<{ id: string; code: string }[]>(
      await admin.get('/api/v1/docflow/journals'),
    );
    const documentId = (
      await json<{ id: string }>(
        await admin.post('/api/v1/docflow/documents/register-incoming', {
          headers,
          data: {
            idempotencyKey: crypto.randomUUID(),
            journalId: journals.find((j) => j.code === 'incoming')!.id,
            typeCode: 'letter',
            subject: `Таймаут ознакомления ${Date.now()}`,
          },
        }),
      )
    ).id;

    const created = await json<ProposalDto>(
      await admin.post(`/api/v1/docflow/documents/${documentId}/resolution-proposals`, {
        headers,
        data: {
          text: 'Ознакомить и исполнить',
          signerId: me,
          responsibleExecutorId: idOf(E2E_USER2.username),
          acquaintUserIds: [idOf(E2E_USER.username), idOf(E2E_USER2.username)],
        },
      }),
    );
    await admin.post(`/api/v1/docflow/resolution-proposals/${created.id}/actions/submit`, {
      headers,
      data: {},
    });
    const approved = await json<ProposalDto>(
      await admin.post(`/api/v1/docflow/resolution-proposals/${created.id}/actions/approve`, {
        headers,
        data: {},
      }),
    );
    expect(approved.gate!.releasedAt, 'the gate starts shut').toBeNull();

    // One reader answers; the other stays silent on purpose.
    const reader = await apiLogin(E2E_USER.username, E2E_USER.password);
    await reader.post(
      `/api/v1/docflow/acquaintance-batches/${approved.gate!.id}/actions/acknowledge`,
      { headers: await csrfHeaders(reader), data: {} },
    );
    await reader.dispose();

    // Wait out the gate plus one sweep interval.
    let gate: GateDto | null = null;
    const deadline = Date.now() + 150_000;
    while (Date.now() < deadline) {
      const list = await json<ProposalDto[]>(
        await admin.get(`/api/v1/docflow/documents/${documentId}/resolution-proposals`),
      );
      gate = list[0]?.gate ?? null;
      if (gate?.releasedAt) break;
      await new Promise((r) => setTimeout(r, 5_000));
    }
    expect(gate?.releasedAt, 'the sweep opened the gate').toBeTruthy();
    expect(gate?.releasedReason).toBe('timeout');

    const byUser = new Map(gate!.lines.map((l) => [l.userId, l.status]));
    expect(byUser.get(idOf(E2E_USER.username)), 'a reading stays a reading').toBe('acknowledged');
    expect(byUser.get(idOf(E2E_USER2.username)), 'silence is not compliance').toBe('expired');

    // And the instruction really is live now.
    const executor = await apiLogin(E2E_USER2.username, E2E_USER2.password);
    const tasks = await json<{ items: { id: string }[] }>(
      await executor.get('/api/v1/docflow/documents?queue=my_tasks&page=1&limit=200'),
    );
    expect(tasks.items.map((d) => d.id)).toContain(documentId);
    await executor.dispose();
    await admin.dispose();
  });
});
