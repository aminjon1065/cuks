// Shared config + auth helper for the k6 load tests (docs/runbook-load.md, task 7.4).
// k6 is a separate runtime (not Node) — these files run only under `k6 run`, not the app build.
import http from 'k6/http';
import { check } from 'k6';

export const BASE = __ENV.CUKS_URL || 'http://localhost:3000';
export const CSRF_COOKIE = 'cuks_csrf';
export const CSRF_HEADER = 'x-csrf-token';

/** Target concurrency + shape, all overridable via env (VUS, RAMP, HOLD). */
export const VUS = Number(__ENV.VUS || 300);
export function rampingStages() {
  return [
    { duration: __ENV.RAMP || '1m', target: VUS },
    { duration: __ENV.HOLD || '3m', target: VUS },
    { duration: __ENV.RAMPDOWN || '30s', target: 0 },
  ];
}

/**
 * Load users to spread session/auth across. Pass CUKS_USERS="u1:p1,u2:p2,…" for a realistic mix, or a
 * single CUKS_USER/CUKS_PASS. Default is the seeded e2e duty officer (no 2FA gate; holds the read
 * permissions the api scenario exercises). See the runbook on relaxing the login lockout for the run.
 */
export function userPool() {
  if (__ENV.CUKS_USERS) {
    return __ENV.CUKS_USERS.split(',')
      .map((pair) => pair.trim())
      .filter(Boolean)
      .map((pair) => {
        const [username, password] = pair.split(':');
        return { username, password };
      });
  }
  return [
    { username: __ENV.CUKS_USER || 'e2e_duty', password: __ENV.CUKS_PASS || 'E2eDuty!Passw0rd' },
  ];
}

/**
 * Log in once and capture the session + csrf cookies (k6 sees httpOnly cookies — it is not a browser).
 * Returns a replayable Cookie header + csrf token so the 300 VUs don't each hit /auth/login (which would
 * trip the per-user/per-IP lockout). Session load is still spread across the user pool.
 */
export function login(username, password) {
  const jar = http.cookieJar();
  const res = http.post(`${BASE}/api/auth/login`, JSON.stringify({ username, password }), {
    headers: { 'Content-Type': 'application/json' },
    tags: { name: 'login' },
  });
  const ok = check(res, { 'login 200': (r) => r.status === 200 });
  const cookies = jar.cookiesForURL(`${BASE}/`);
  const cookieHeader = Object.keys(cookies)
    .map((name) => `${name}=${cookies[name][0]}`)
    .join('; ');
  const csrf = (cookies[CSRF_COOKIE] || [''])[0];
  return { ok, cookieHeader, csrf, username };
}

/** setup() body shared by both scenarios: log in the whole pool, fail fast if none can. */
export function authenticatePool() {
  const auths = userPool()
    .map((u) => login(u.username, u.password))
    .filter((a) => a.ok);
  if (auths.length === 0) {
    throw new Error(
      'no load user could log in — check CUKS_USER/CUKS_PASS, that the user is seeded, and that the ' +
        'login lockout is relaxed for the load source (docs/runbook-load.md)',
    );
  }
  return { auths };
}
