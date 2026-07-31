import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { SESSION_COOKIE } from '@cuks/shared';
import { LockoutService } from '../../modules/auth/lockout.service';
import { THROTTLE_KEY, type ThrottleOptions } from '../decorators/throttle.decorator';
import { AppException } from '../exceptions/app.exception';

/**
 * Enforces `@Throttle(limit, window)` as a fixed-window limit (docs/09 §1), keyed on the
 * session when the request carries one and on `request.ip` otherwise. The IP is only
 * trustworthy because TRUST_PROXY is not blanket-enabled (see main.ts).
 */
@Injectable()
export class ThrottleGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly lockout: LockoutService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const options = this.reflector.getAllAndOverride<ThrottleOptions | undefined>(THROTTLE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!options) return true;

    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const route = `${context.getClass().name}.${context.getHandler().name}`;

    // TWO buckets, both of which must pass.
    //
    // The IP bucket is the ceiling, and it is not optional: it is the only key the caller
    // cannot choose. The session cookie is read here raw — this guard deliberately runs BEFORE
    // the session guard, so a flood is turned away before it costs a session lookup — and a
    // raw cookie is just a header the client writes. Keying ONLY on it would let anybody defeat
    // the login limit by sending a fresh random value with every request.
    //
    // The session bucket is added on top for fairness behind one office NAT, where an IP-only
    // limit means one person typing quickly into a search box spends the whole floor's budget.
    // It can be forged, which is exactly why it can only ever make the limit stricter.
    const sessionId = request.cookies?.[SESSION_COOKIE];
    const buckets = [`${route}:ip:${request.ip}`];
    if (sessionId) buckets.push(`${route}:s:${sessionId}`);

    for (const bucket of buckets) {
      if (await this.lockout.hitRate(bucket, options.limit, options.windowSeconds)) {
        throw AppException.tooManyRequests('common.rate_limited', 'Too many requests');
      }
    }
    return true;
  }
}
