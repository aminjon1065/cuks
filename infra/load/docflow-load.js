// СЭД load scenario — 200 concurrent users over the register's real read/write mix
// (plan §14, этап 11; docs/runbook-load.md). Run:
//   k6 run -e CUKS_URL=... -e CUKS_USERS="clerk:pw,chief:pw,exec:pw" infra/load/docflow-load.js
//
// Why its own profile rather than more endpoints in api-load.js: the register is the only part
// of the system with a per-journal serialization point (the registration counter), so its load
// shape is a read mix WITH a contended write in it. Measuring the reads alone would miss the
// one thing that can actually queue.
import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { BASE, CSRF_HEADER, authenticatePool } from './config.js';

/** Target concurrency — the non-functional criterion is 200 concurrent active users. */
const VUS = Number(__ENV.VUS || 200);

/**
 * Share of iterations that take the write path (register → route → approve). The rest are
 * reads. 15% is deliberately higher than a real working day: the point is to keep the counter
 * and the route tables under continuous contention, not to reproduce an average.
 */
const WRITE_SHARE = Number(__ENV.WRITE_SHARE || 0.15);

export const options = {
  scenarios: {
    docflow: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: __ENV.RAMP || '1m', target: VUS },
        { duration: __ENV.HOLD || '3m', target: VUS },
        { duration: __ENV.RAMPDOWN || '30s', target: 0 },
      ],
      gracefulRampDown: '20s',
    },
  },
  // The budgets from plan §14, per tagged endpoint. Untagged aggregate stays loose on purpose —
  // an XLSX export or a route approval is not what those numbers were written about.
  thresholds: {
    http_req_failed: ['rate<0.01'],
    checks: ['rate>0.99'],
    'http_req_duration{name:register-list}': ['p(95)<500'],
    'http_req_duration{name:queue-counts}': ['p(95)<500'],
    'http_req_duration{name:card}': ['p(95)<700'],
    'http_req_duration{name:card-history}': ['p(95)<700'],
    'http_req_duration{name:search}': ['p(95)<1000'],
    'http_req_duration{name:dashboard}': ['p(95)<1000'],
    'http_req_duration{name:attention}': ['p(95)<1000'],
    // The contended write. No plan budget names it; 2s is the point at which a clerk notices
    // that «зарегистрировать» hangs, which is the question this scenario is really asking.
    'http_req_duration{name:register-doc}': ['p(95)<2000'],
  },
};

const SEARCH_TERMS = (__ENV.SEARCH_TERMS || 'письмо,запрос,отчёт,комиссия,ситуация').split(',');

/**
 * A dedicated journal per run so the counter contention is real but isolated: 200 VUs hammering
 * a production journal would advance its live numbering by thousands. `seqReset: 'never'` keeps
 * the sequence a single monotonic series, which is what makes gaps detectable afterwards.
 *
 * Also picks up a page of existing documents to read — the card/history paths need ids that are
 * visible to the load users, and inventing them would only measure 404s.
 */
export function setup() {
  const pool = authenticatePool();
  const auth = pool.auths[0];
  const headers = {
    Cookie: auth.cookieHeader,
    [CSRF_HEADER]: auth.csrf,
    'Content-Type': 'application/json',
  };

  const stamp = `${Date.now()}`;
  const journalRes = http.post(
    `${BASE}/api/v1/docflow/journals`,
    JSON.stringify({
      code: `k6-${stamp}`,
      name: `Нагрузочный журнал ${stamp}`,
      docClass: 'incoming',
      numberTemplate: '{seq5}',
      seqReset: 'never',
    }),
    { headers, tags: { name: 'setup' } },
  );
  if (journalRes.status !== 201 && journalRes.status !== 200) {
    throw new Error(
      `could not create the load journal (${journalRes.status}) — the load user needs ` +
        '`docflow.journals.manage`, or pass JOURNAL_ID of an existing throwaway journal',
    );
  }
  const journalId = __ENV.JOURNAL_ID || journalRes.json('id');

  const listRes = http.get(`${BASE}/api/v1/docflow/documents?page=1&limit=50&queue=registry`, {
    headers: { Cookie: auth.cookieHeader },
    tags: { name: 'setup' },
  });
  const items = listRes.status === 200 ? listRes.json('items') || [] : [];
  const documentIds = items.map((d) => d.id);
  if (documentIds.length === 0) {
    throw new Error(
      'the load user sees no documents — seed a test volume first ' +
        '(`pnpm --filter @cuks/db seed:perf:docs`), otherwise the card path measures nothing',
    );
  }

  return { auths: pool.auths, journalId, documentIds, stamp };
}

function readPaths(data) {
  const id = data.documentIds[Math.floor(Math.random() * data.documentIds.length)];
  const term = SEARCH_TERMS[Math.floor(Math.random() * SEARCH_TERMS.length)];
  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return [
    { name: 'register-list', path: '/api/v1/docflow/documents?page=1&limit=25&queue=mine' },
    { name: 'queue-counts', path: '/api/v1/docflow/documents/queue-counts' },
    { name: 'attention', path: '/api/v1/docflow/attention' },
    {
      name: 'search',
      path: `/api/v1/docflow/search?q=${encodeURIComponent(term)}&page=1&limit=20`,
    },
    { name: 'card', path: `/api/v1/docflow/documents/${id}` },
    { name: 'card-history', path: `/api/v1/docflow/documents/${id}/history` },
    {
      name: 'dashboard',
      path: `/api/v1/docflow/reports/register?kind=registration&from=${from}&to=${to}`,
    },
  ];
}

/** A fresh draft, marked so the run can be cleaned up afterwards (see the runbook). */
function createDraft(data, headers, suffix) {
  const res = http.post(
    `${BASE}/api/v1/docflow/documents`,
    JSON.stringify({
      docClass: 'incoming',
      typeCode: 'letter',
      subject: `[k6 ${data.stamp}] нагрузочный документ ${__VU}-${__ITER}-${suffix}`,
    }),
    { headers, tags: { name: 'create-draft' } },
  );
  return check(res, { 'draft created': (r) => r.status === 201 || r.status === 200 })
    ? res.json('id')
    : null;
}

/**
 * The two contended writes from plan этап 11 («register / route action»), and the whole reason
 * this scenario exists: the per-journal counter upsert and the route insert are where 200 users
 * meet each other.
 *
 * They run on two SEPARATE drafts on purpose — `startRoute` refuses anything but a draft
 * (routes.service.ts `docflow.route.not_draft`), so a register-then-route chain would measure a
 * 409 rather than a route.
 */
function writePath(data, auth) {
  const headers = {
    Cookie: auth.cookieHeader,
    [CSRF_HEADER]: auth.csrf,
    'Content-Type': 'application/json',
  };

  const toRegister = createDraft(data, headers, 'reg');
  if (toRegister) {
    const registered = http.post(
      `${BASE}/api/v1/docflow/documents/${toRegister}/actions/register`,
      JSON.stringify({ journalId: data.journalId }),
      { headers, tags: { name: 'register-doc' } },
    );
    check(registered, {
      // A duplicate number is a 409 from the unique index, i.e. the counter lost a race. Failing
      // this check is the signal; the gap analysis afterwards is in the runbook.
      registered: (r) => r.status === 200 || r.status === 201,
      'no duplicate number': (r) => r.status !== 409,
    });
  }

  const toRoute = createDraft(data, headers, 'route');
  if (!toRoute) return;
  // A one-step route back at the author: still a full route insert + step activation, and it
  // needs no second seeded user to stay available for 200 VUs at once.
  const route = http.post(
    `${BASE}/api/v1/docflow/documents/${toRoute}/route`,
    JSON.stringify({
      steps: [{ order: 0, kind: 'approve', assigneeType: 'user', assigneeId: auth.userId }],
    }),
    { headers, tags: { name: 'route-start' } },
  );
  if (!check(route, { 'route started': (r) => r.status === 201 || r.status === 200 })) return;

  // The endpoint returns the document's route CYCLES, not steps. The draft is fresh, so there is
  // exactly one, and it is active — found by status rather than by index so the scenario does not
  // depend on an ordering the DTO never promised.
  const cycles = route.json() || [];
  const active = cycles.filter((c) => c.status === 'active')[0];
  const step = active && active.steps ? active.steps[0] : null;
  if (!step) return;
  const approved = http.post(
    `${BASE}/api/v1/docflow/route-steps/${step.id}/actions/approve`,
    JSON.stringify({ comment: 'k6' }),
    { headers, tags: { name: 'route-action' } },
  );
  check(approved, { 'step approved': (r) => r.status === 200 || r.status === 201 });
}

export default function (data) {
  const auth = data.auths[(__VU - 1) % data.auths.length];
  const params = { headers: { Cookie: auth.cookieHeader } };

  group('register reads', () => {
    for (const ep of readPaths(data)) {
      const res = http.get(`${BASE}${ep.path}`, { ...params, tags: { name: ep.name } });
      check(res, { [`${ep.name} 200`]: (r) => r.status === 200 });
    }
  });

  if (Math.random() < WRITE_SHARE) {
    group('register writes', () => writePath(data, auth));
  }

  sleep(Number(__ENV.THINK || 1));
}
