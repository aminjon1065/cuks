import type { FastifyReply } from 'fastify';
import { CSRF_COOKIE, SESSION_COOKIE } from '@cuks/shared';

/** Set the session (httpOnly) and CSRF (JS-readable, double-submit) cookies. */
export function setSessionCookies(
  reply: FastifyReply,
  params: { sessionId: string; csrfToken: string; ttlSeconds: number; secure: boolean },
): void {
  void reply.setCookie(SESSION_COOKIE, params.sessionId, {
    httpOnly: true,
    secure: params.secure,
    sameSite: 'lax',
    path: '/',
    maxAge: params.ttlSeconds,
  });
  void reply.setCookie(CSRF_COOKIE, params.csrfToken, {
    httpOnly: false,
    secure: params.secure,
    sameSite: 'lax',
    path: '/',
    maxAge: params.ttlSeconds,
  });
}

export function clearSessionCookies(reply: FastifyReply): void {
  void reply.clearCookie(SESSION_COOKIE, { path: '/' });
  void reply.clearCookie(CSRF_COOKIE, { path: '/' });
}
