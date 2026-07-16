import { expect, request, test, type APIRequestContext } from '@playwright/test';
import { apiLogin, csrfHeaders } from './support/api';
import { E2E_USER, E2E_USER2, STORAGE_STATE } from './support/fixtures';

/**
 * Route substitutions «за» (docs/05-auth-rbac.md §6, task 3.11). Drives the real engine over the
 * API + PostgreSQL: a document is routed to a principal for approval; before any substitution the
 * deputy cannot see it, but once the principal delegates to them the deputy sees it in their
 * to_approve queue («за» the principal), can open it, and approves it — the step records acted_by =
 * the deputy and «за» the principal.
 */
const API = 'http://localhost:3000';

interface DocumentDto {
  id: string;
}
interface RouteStepDto {
  id: string;
  status: string;
  canAct: boolean;
  actedByName: string | null;
  actedForName: string | null;
  actOnBehalfOfName: string | null;
}
interface RouteDto {
  status: string;
  steps: RouteStepDto[];
}
interface ListItem {
  id: string;
  actionStepId: string | null;
  actionOnBehalfOfName: string | null;
}

async function json<T>(res: { json: () => Promise<unknown> }): Promise<T> {
  return (await res.json()) as T;
}
async function jsonHeaders(ctx: APIRequestContext): Promise<Record<string, string>> {
  return { ...(await csrfHeaders(ctx)), 'content-type': 'application/json' };
}

/** Remove any substitution for the deputy (seed:e2e does not wipe docflow, so prior runs leave
 *  active rows). The admin may delete anyone's. */
async function clearSubstitutions(admin: APIRequestContext, deputyId: string): Promise<void> {
  const all = await json<{ id: string; deputyId: string }[]>(
    await admin.get('/api/v1/docflow/substitutions'),
  );
  for (const s of all.filter((x) => x.deputyId === deputyId)) {
    await admin.delete(`/api/v1/docflow/substitutions/${s.id}`, {
      headers: await csrfHeaders(admin),
    });
  }
}

test('substitutions: a deputy sees, opens and approves a principal’s step «за» them', async () => {
  const admin = await request.newContext({ storageState: STORAGE_STATE, baseURL: API });
  const headers = await jsonHeaders(admin);
  const users = (
    await json<{ items: { id: string; username: string }[] }>(
      await admin.get('/api/v1/admin/users?page=1&limit=100'),
    )
  ).items;
  const principal = users.find((u) => u.username === E2E_USER.username)!;
  const deputyUser = users.find((u) => u.username === E2E_USER2.username)!;
  await clearSubstitutions(admin, deputyUser.id);

  // Admin routes a document to the principal for approval.
  const doc = await json<DocumentDto>(
    await admin.post('/api/v1/docflow/documents', {
      headers,
      data: { docClass: 'internal', typeCode: 'order', subject: `Зам ${Date.now()}` },
    }),
  );
  await admin.post(`/api/v1/docflow/documents/${doc.id}/route`, {
    headers,
    data: {
      steps: [{ order: 1, kind: 'approve', assigneeType: 'user', assigneeId: principal.id }],
    },
  });

  // Before any substitution, the deputy cannot see the document nor find it in their queue.
  const deputy = await apiLogin(E2E_USER2.username, E2E_USER2.password);
  expect((await deputy.get(`/api/v1/docflow/documents/${doc.id}`)).status()).toBe(404);
  const before = await json<{ items: ListItem[] }>(
    await deputy.get('/api/v1/docflow/documents?queue=to_approve&page=1&limit=100'),
  );
  expect(before.items.some((d) => d.id === doc.id)).toBe(false);

  // The principal delegates their route duties to the deputy (open-ended, active now).
  const principalCtx = await apiLogin(E2E_USER.username, E2E_USER.password);
  const created = await principalCtx.post('/api/v1/docflow/substitutions', {
    headers: await jsonHeaders(principalCtx),
    data: { principalId: principal.id, deputyId: deputyUser.id, scope: 'docflow' },
  });
  expect(created.ok(), `create substitution ${created.status()}`).toBeTruthy();

  // Now the deputy sees the document in their to_approve queue, marked «за» the principal.
  const after = await json<{ items: ListItem[] }>(
    await deputy.get('/api/v1/docflow/documents?queue=to_approve&page=1&limit=100'),
  );
  const queued = after.items.find((d) => d.id === doc.id);
  expect(queued, 'the principal’s step is now in the deputy’s queue').toBeTruthy();
  expect(queued!.actionOnBehalfOfName, '«за кого» is shown').toBeTruthy();

  // The deputy may open the card and act on the step.
  expect((await deputy.get(`/api/v1/docflow/documents/${doc.id}`)).ok()).toBeTruthy();
  const routes = await json<RouteDto[]>(
    await deputy.get(`/api/v1/docflow/documents/${doc.id}/routes`),
  );
  const step = routes[0]!.steps.find((s) => s.canAct)!;
  expect(step, 'the deputy has an actionable step').toBeTruthy();
  expect(step.actOnBehalfOfName, 'the step names the principal').toBeTruthy();
  const acted = await deputy.post(`/api/v1/docflow/route-steps/${step.id}/actions/approve`, {
    headers: await jsonHeaders(deputy),
    data: {},
  });
  expect(acted.ok(), `approve ${acted.status()}`).toBeTruthy();

  // The completed step is attributed to the deputy, acting «за» the principal.
  const finalRoutes = await json<RouteDto[]>(
    await admin.get(`/api/v1/docflow/documents/${doc.id}/routes`),
  );
  const done = finalRoutes[0]!.steps[0]!;
  expect(done.status).toBe('done');
  expect(done.actedForName, 'recorded «за» the principal').toBeTruthy();

  await Promise.all([admin.dispose(), deputy.dispose(), principalCtx.dispose()]);
});

test('substitutions: a deputy reaches the sign step and Подписи panel «за» the principal', async () => {
  const admin = await request.newContext({ storageState: STORAGE_STATE, baseURL: API });
  const headers = await jsonHeaders(admin);
  const users = (
    await json<{ items: { id: string; username: string }[] }>(
      await admin.get('/api/v1/admin/users?page=1&limit=100'),
    )
  ).items;
  const principal = users.find((u) => u.username === E2E_USER.username)!;
  const deputyUser = users.find((u) => u.username === E2E_USER2.username)!;
  await clearSubstitutions(admin, deputyUser.id);

  // Admin routes a document with a SIGN step assigned to the principal.
  const doc = await json<DocumentDto>(
    await admin.post('/api/v1/docflow/documents', {
      headers,
      data: { docClass: 'outgoing', typeCode: 'letter', subject: `Подпись-зам ${Date.now()}` },
    }),
  );
  await admin.post(`/api/v1/docflow/documents/${doc.id}/route`, {
    headers,
    data: { steps: [{ order: 1, kind: 'sign', assigneeType: 'user', assigneeId: principal.id }] },
  });

  const deputy = await apiLogin(E2E_USER2.username, E2E_USER2.password);
  // Before delegation the deputy cannot see the document's signatures panel.
  expect((await deputy.get(`/api/v1/docflow/documents/${doc.id}/signatures`)).status()).toBe(404);

  const principalCtx = await apiLogin(E2E_USER.username, E2E_USER.password);
  await principalCtx.post('/api/v1/docflow/substitutions', {
    headers: await jsonHeaders(principalCtx),
    data: { principalId: principal.id, deputyId: deputyUser.id, scope: 'docflow' },
  });

  // Now the signatures panel loads (canViewDocument is substitution-aware — the sign gate too),
  // and the sign step is actionable «за» the principal.
  expect((await deputy.get(`/api/v1/docflow/documents/${doc.id}/signatures`)).ok()).toBeTruthy();
  const routes = await json<RouteDto[]>(
    await deputy.get(`/api/v1/docflow/documents/${doc.id}/routes`),
  );
  const signStep = routes[0]!.steps.find((s) => s.canAct)!;
  expect(signStep, 'the deputy has an actionable sign step').toBeTruthy();
  expect(signStep.actOnBehalfOfName, 'the sign step names the principal').toBeTruthy();

  await Promise.all([admin.dispose(), deputy.dispose(), principalCtx.dispose()]);
});
