import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CSRF_HEADER } from '@cuks/shared';
import { ConfigService } from '../../config/config.service';
import type { AuthenticatedRequest } from '../auth/auth-user';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { AppException } from '../exceptions/app.exception';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF protection for state-changing requests (docs/05 §1, docs/09 §1):
 * double-submit cookie (X-CSRF-Token header must equal the session's token) plus
 * an Origin check. Safe methods and `@Public()` routes (no session yet) are exempt.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly config: ConfigService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (SAFE_METHODS.has(request.method)) return true;

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const origin = request.headers.origin;
    if (origin && origin !== this.config.get('APP_ORIGIN')) {
      throw AppException.forbidden('auth.csrf.origin_mismatch', 'Origin not allowed');
    }

    const header = request.headers[CSRF_HEADER];
    const provided = Array.isArray(header) ? header[0] : header;
    if (!request.sessionCsrf || !provided || provided !== request.sessionCsrf) {
      throw AppException.forbidden('auth.csrf.invalid', 'Invalid CSRF token');
    }
    return true;
  }
}
