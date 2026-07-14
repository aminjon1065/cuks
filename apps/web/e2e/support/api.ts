import { expect, request, type APIRequestContext } from '@playwright/test';

/** The API is reached directly (the web dev server only proxies it); cookies are
 *  host-scoped so the session works the same as through the proxy. */
const API_BASE = 'http://localhost:3000';

// Mirrors @cuks/shared CSRF_COOKIE / CSRF_HEADER — inlined because Playwright's
// runner resolves `@cuks/shared` to its built package (not the app's src alias).
const CSRF_COOKIE = 'cuks_csrf';
const CSRF_HEADER = 'x-csrf-token';

/** A fresh API context authenticated as the given user (session + csrf cookies). */
export async function apiLogin(username: string, password: string): Promise<APIRequestContext> {
  const ctx = await request.newContext({ baseURL: API_BASE });
  const res = await ctx.post('/api/auth/login', { data: { username, password } });
  expect(res.ok(), `login ${username} failed (${res.status()})`).toBeTruthy();
  return ctx;
}

/** Double-submit CSRF header read from the context's cookie — required on every
 *  mutating request (docs/05 §1). */
export async function csrfHeaders(ctx: APIRequestContext): Promise<Record<string, string>> {
  const state = await ctx.storageState();
  const token = state.cookies.find((c) => c.name === CSRF_COOKIE)?.value ?? '';
  return { [CSRF_HEADER]: token };
}
