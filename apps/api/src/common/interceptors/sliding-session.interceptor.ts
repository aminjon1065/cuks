import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyReply } from 'fastify';
import { type Observable, tap } from 'rxjs';
import { SESSION_REMEMBER_TTL_SECONDS, SESSION_TTL_SECONDS } from '@cuks/shared';
import type { AuthenticatedRequest } from '../auth/auth-user';
import { setSessionCookies } from '../auth/session-cookies';
import { ConfigService } from '../../config/config.service';
import { SKIP_SESSION_REFRESH_KEY } from '../decorators/skip-session-refresh.decorator';

/**
 * Sliding session: re-issue the session + CSRF cookies with a fresh max-age on
 * each authenticated response, mirroring the Redis TTL bump (docs/05 §1:
 * "TTL 12 ч скользящий"). `@SkipSessionRefresh()` routes (logout) opt out.
 */
@Injectable()
export class SlidingSessionInterceptor implements NestInterceptor {
  constructor(
    private readonly config: ConfigService,
    private readonly reflector: Reflector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_SESSION_REFRESH_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    return next.handle().pipe(
      tap(() => {
        const user = request.authUser;
        if (!user || skip || !request.sessionCsrf) return;
        const reply = context.switchToHttp().getResponse<FastifyReply>();
        setSessionCookies(reply, {
          sessionId: user.sessionId,
          csrfToken: request.sessionCsrf,
          ttlSeconds: request.sessionRemember ? SESSION_REMEMBER_TTL_SECONDS : SESSION_TTL_SECONDS,
          secure: this.config.isProduction,
        });
      }),
    );
  }
}
