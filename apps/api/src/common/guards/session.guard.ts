import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SESSION_COOKIE } from '@cuks/shared';
import { SessionService } from '../../modules/auth/session.service';
import { UsersService } from '../../modules/users/users.service';
import type { AuthenticatedRequest } from '../auth/auth-user';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { AppException } from '../exceptions/app.exception';

/**
 * Resolves the session cookie against Redis, loads the (fresh) user + permissions,
 * and attaches them to the request. Sliding-refreshes the session. `@Public()`
 * routes skip auth (docs/05 §1). Permissions are read per request so role changes
 * and session revocation take effect immediately (docs/02 ADR-3).
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
    private readonly users: UsersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const sessionId = request.cookies?.[SESSION_COOKIE];
    if (!sessionId) throw AppException.unauthorized('auth.session.missing', 'Not authenticated');

    const session = await this.sessions.get(sessionId);
    if (!session) throw AppException.unauthorized('auth.session.invalid', 'Session expired');

    const user = await this.users.findActiveById(session.userId);
    if (!user || user.status === 'blocked') {
      await this.sessions.revoke(session.userId, sessionId);
      throw AppException.unauthorized('auth.session.invalid', 'Session no longer valid');
    }

    const { permissions, isSuperadmin } = await this.users.getPermissions(user.id);
    await this.sessions.refresh(sessionId, session);

    request.authUser = {
      id: user.id,
      username: user.username,
      fullName: user.fullName,
      shortName: user.shortName,
      email: user.email,
      locale: user.locale,
      theme: user.theme,
      status: user.status,
      totpEnabled: user.totpEnabled,
      mustChangePassword: user.mustChangePassword,
      permissions,
      isSuperadmin,
      sessionId,
    };
    request.sessionCsrf = session.csrfToken;
    return true;
  }
}
