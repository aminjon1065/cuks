import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_REQUIRING_2FA } from '@cuks/shared';
import type { AuthenticatedRequest } from '../auth/auth-user';
import { ALLOW_TOTP_ENROLLMENT_KEY } from '../decorators/allow-totp-enrollment.decorator';
import { AppException } from '../exceptions/app.exception';

/**
 * TOTP is mandatory for privileged roles (admin.*, docflow.sign, gis.pg.access —
 * docs/05 §1). Until such a user enables it, only routes marked
 * `@AllowDuringTotpEnrollment()` are reachable, forcing enrollment.
 */
@Injectable()
export class TotpEnrollmentGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.authUser;
    if (!user || user.totpEnabled) return true;

    const required =
      user.isSuperadmin || user.permissions.some((p) => PERMISSIONS_REQUIRING_2FA.includes(p));
    if (!required) return true;

    const allowed = this.reflector.getAllAndOverride<boolean>(ALLOW_TOTP_ENROLLMENT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (allowed) return true;

    throw AppException.forbidden('auth.totp.enrollment_required', 'Two-factor enrollment required');
  }
}
