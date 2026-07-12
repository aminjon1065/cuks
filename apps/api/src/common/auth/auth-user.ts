import type { FastifyRequest } from 'fastify';
import type { Locale, Theme, UserStatus } from '@cuks/shared';

/** The authenticated principal resolved from the session and attached to the request. */
export interface AuthUser {
  id: string;
  username: string;
  fullName: string;
  shortName: string;
  email: string | null;
  locale: Locale;
  theme: Theme;
  status: UserStatus;
  totpEnabled: boolean;
  mustChangePassword: boolean;
  permissions: string[];
  isSuperadmin: boolean;
  sessionId: string;
}

export interface AuthenticatedRequest extends FastifyRequest {
  authUser?: AuthUser;
  /** CSRF token from the current session, set by the SessionGuard for the CsrfGuard. */
  sessionCsrf?: string;
  /** Whether the session is a "remember me" session (for the sliding cookie TTL). */
  sessionRemember?: boolean;
}
