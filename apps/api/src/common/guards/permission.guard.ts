import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { buildAbility, hasPermission } from '@cuks/shared';
import type { AuthenticatedRequest } from '../auth/auth-user';
import { REQUIRED_PERMISSION_KEY } from '../decorators/require-permission.decorator';
import { AppException } from '../exceptions/app.exception';

/** Enforces `@RequirePermission(...)` via the user's CASL ability (docs/05 §3). */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string | undefined>(REQUIRED_PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.authUser;
    if (!user) throw AppException.unauthorized('auth.session.missing', 'Not authenticated');

    const ability = buildAbility({
      permissions: user.permissions,
      isSuperadmin: user.isSuperadmin,
    });
    if (!hasPermission(ability, required)) {
      throw AppException.forbidden('auth.permission.denied', `Missing permission: ${required}`);
    }
    return true;
  }
}
