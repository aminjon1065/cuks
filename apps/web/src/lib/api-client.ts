import { CSRF_COOKIE, CSRF_HEADER } from '@cuks/shared';

/**
 * Fetch wrapper for the CUKS API (docs/05 §1, docs/04). Server sessions live in
 * httpOnly cookies, so every call sends credentials; state-changing requests
 * echo the readable CSRF cookie back in the `x-csrf-token` header (double-submit).
 * All calls go through the same-origin `/api` prefix (Vite proxy in dev, Caddy in
 * prod). The standard error envelope `{ error: { code, message, … } }` is unpacked
 * into an {@link ApiError}.
 */
const API_PREFIX = '/api';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export interface ApiErrorBody {
  code: string;
  message: string;
  details?: unknown;
  requestId?: string;
}

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: unknown;
  readonly requestId: string | undefined;

  constructor(status: number, body: ApiErrorBody) {
    super(body.message);
    this.name = 'ApiError';
    this.code = body.code;
    this.status = status;
    this.details = body.details;
    this.requestId = body.requestId;
  }
}

function readCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

export interface RequestOptions {
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
}

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = (options.method ?? 'GET').toUpperCase();
  const headers: Record<string, string> = { Accept: 'application/json' };

  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (!SAFE_METHODS.has(method)) {
    const csrf = readCookie(CSRF_COOKIE);
    if (csrf) headers[CSRF_HEADER] = csrf;
  }

  const init: RequestInit = { method, headers, credentials: 'include' };
  if (options.body !== undefined) init.body = JSON.stringify(options.body);
  if (options.signal) init.signal = options.signal;

  const response = await fetch(`${API_PREFIX}${path}`, init);

  if (response.status === 204) return undefined as T;

  const isJson = response.headers.get('content-type')?.includes('application/json');
  const payload: unknown = isJson ? await response.json() : await response.text();

  if (!response.ok) {
    const body =
      isJson && payload && typeof payload === 'object' && 'error' in payload
        ? (payload as { error: ApiErrorBody }).error
        : { code: 'http.error', message: `HTTP ${response.status}` };
    throw new ApiError(response.status, body);
  }

  return payload as T;
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal): Promise<T> =>
    apiFetch<T>(path, signal ? { signal } : {}),
  post: <T>(path: string, body?: unknown): Promise<T> =>
    apiFetch<T>(path, body === undefined ? { method: 'POST' } : { method: 'POST', body }),
  patch: <T>(path: string, body?: unknown): Promise<T> =>
    apiFetch<T>(path, body === undefined ? { method: 'PATCH' } : { method: 'PATCH', body }),
  delete: <T>(path: string): Promise<T> => apiFetch<T>(path, { method: 'DELETE' }),
};
