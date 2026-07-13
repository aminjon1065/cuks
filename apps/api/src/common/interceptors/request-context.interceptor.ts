import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import type { Observable } from 'rxjs';
import type { AuthenticatedRequest } from '../auth/auth-user';
import { requestContext } from '../request-context/request-context';

/**
 * Seeds the per-request {@link requestContext} with ip / user-agent / actor so audit
 * events are attributed without every service threading the request. Runs after the
 * guards (which set `authUser`); `enterWith` keeps the store live for the handler and
 * everything it calls. HTTP only. `request.ip` is trustworthy because TRUST_PROXY
 * defaults to off (main.ts) — same source the throttle guard uses.
 */
@Injectable()
export class RequestContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const userAgent = request.headers['user-agent'];
    requestContext.enterWith({
      ip: request.ip ?? null,
      userAgent: (Array.isArray(userAgent) ? userAgent[0] : userAgent) ?? null,
      actorId: request.authUser?.id ?? null,
    });
    return next.handle();
  }
}
