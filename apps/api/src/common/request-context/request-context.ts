import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Per-request ambient context (ip, user-agent, actor) so cross-cutting concerns —
 * notably {@link AuditService} — can enrich events without every service threading
 * the request through. Populated once per HTTP request by the
 * RequestContextInterceptor; read via {@link getRequestContext}. Node's
 * AsyncLocalStorage keeps it isolated per async call chain (no new dependency).
 */
export interface RequestContextStore {
  ip: string | null;
  userAgent: string | null;
  actorId: string | null;
}

export const requestContext = new AsyncLocalStorage<RequestContextStore>();

export function getRequestContext(): RequestContextStore | undefined {
  return requestContext.getStore();
}
