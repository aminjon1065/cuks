// REST load scenario — ramp to 300 concurrent users doing a read-mostly mix (docs/runbook-load.md,
// task 7.4). Run: k6 run -e CUKS_URL=... -e CUKS_USER=... -e CUKS_PASS=... infra/load/api-load.js
import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { BASE, rampingStages, authenticatePool } from './config.js';

export const options = {
  scenarios: {
    api: { executor: 'ramping-vus', startVUs: 0, stages: rampingStages(), gracefulRampDown: '20s' },
  },
  thresholds: {
    // Overall: <1% failures, p95 under 800ms. Analytics (aggregations) gets a looser budget.
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<800'],
    'http_req_duration{name:analytics}': ['p(95)<1500'],
    checks: ['rate>0.99'],
  },
};

export const setup = authenticatePool;

// Analytics wants an explicit ISO window (from < to, both with a timezone offset — toISOString()'s Z
// qualifies); there is no `period` param on the API (that's a frontend concept). Compute a 7-day window.
const TO = new Date().toISOString();
const FROM = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

// Core read paths a duty officer hits (all confirmed to exist under /api/v1). Adjust to your deployment.
const READS = [
  { name: 'analytics', path: `/api/v1/analytics/summary?from=${FROM}&to=${TO}` },
  { name: 'incidents', path: '/api/v1/incidents?page=1&limit=25' },
  { name: 'notifications', path: '/api/v1/notifications?limit=20' },
  { name: 'unread', path: '/api/v1/notifications/unread-count' },
  { name: 'channels', path: '/api/v1/chat/channels' },
];

export default function (data) {
  // Spread the session load across the authenticated pool.
  const auth = data.auths[(__VU - 1) % data.auths.length];
  const params = { headers: { Cookie: auth.cookieHeader } };

  group('reads', () => {
    for (const ep of READS) {
      const res = http.get(`${BASE}${ep.path}`, { ...params, tags: { name: ep.name } });
      check(res, { [`${ep.name} 200`]: (r) => r.status === 200 });
    }
  });

  sleep(Number(__ENV.THINK || 1));
}
