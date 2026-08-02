import { expect, request, type APIRequestContext } from '@playwright/test';

/** The API is reached directly (the web dev server only proxies it); cookies are
 *  host-scoped so the session works the same as through the proxy. */
const API_BASE = 'http://localhost:3000';

// Mirrors @cuks/shared CSRF_COOKIE / CSRF_HEADER — inlined because Playwright's
// runner resolves `@cuks/shared` to its built package (not the app's src alias).
const CSRF_COOKIE = 'cuks_csrf';
const CSRF_HEADER = 'x-csrf-token';

/**
 * One session per user per worker process, reused by every test in that worker.
 *
 * `/auth/login` is throttled to AUTH_LOGIN_RATE_PER_MINUTE (10) per IP in a fixed 60-second
 * window (`common/guards/throttle.guard.ts`) — correct product behaviour. The suite makes ~90
 * `apiLogin` calls against three fixture accounts, so logging in per test trips the limit no
 * matter how few workers run, and retrying makes it worse: a retry is another attempt against
 * the same quota. Caching turns ~90 logins into three.
 *
 * The cache is per worker PROCESS, so parallel workers still log in separately — that is the
 * point at which the limit is a real constraint, and the retry below covers it.
 */
const sessions = new Map<string, Promise<Awaited<ReturnType<APIRequestContext['storageState']>>>>();

/** Only 429 is retried; every other status is a real refusal and must fail immediately. */
const LOGIN_RETRIES = 2;
/** A full window plus a second: the limit is fixed-window, so anything less re-enters the same one. */
const LOGIN_BACKOFF_MS = 61_000;

async function login(username: string, password: string): Promise<unknown> {
  const ctx = await request.newContext({ baseURL: API_BASE });
  try {
    let status = 0;
    for (let attempt = 0; attempt <= LOGIN_RETRIES; attempt++) {
      const res = await ctx.post('/api/auth/login', { data: { username, password } });
      if (res.ok()) return await ctx.storageState();
      status = res.status();
      if (status !== 429) break;
      await new Promise((resolve) => setTimeout(resolve, LOGIN_BACKOFF_MS + Math.random() * 500));
    }
    expect(false, `login ${username} failed (${status})`).toBeTruthy();
    throw new Error('unreachable');
  } finally {
    await ctx.dispose();
  }
}

/** A fresh API context authenticated as the given user (session + csrf cookies). */
export async function apiLogin(username: string, password: string): Promise<APIRequestContext> {
  let state = sessions.get(username);
  if (!state) {
    state = login(username, password) as Promise<never>;
    sessions.set(username, state);
  }
  // A new context per call, so a test disposing its own context cannot break another's.
  return request.newContext({ baseURL: API_BASE, storageState: await state });
}

/** Double-submit CSRF header read from the context's cookie — required on every
 *  mutating request (docs/05 §1). */
export async function csrfHeaders(ctx: APIRequestContext): Promise<Record<string, string>> {
  const state = await ctx.storageState();
  const token = state.cookies.find((c) => c.name === CSRF_COOKIE)?.value ?? '';
  return { [CSRF_HEADER]: token };
}
