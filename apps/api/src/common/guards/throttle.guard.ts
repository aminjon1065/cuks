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
    // Keyed on the SESSION when the request carries one, on the IP otherwise.
    //
    // An IP-only bucket is both too tight and too loose behind one office NAT: the whole floor
    // shares a single budget, so one person typing quickly into a search box locks out their
    // colleagues, while an authenticated abuser only has to change address to get a fresh
    // allowance. The cookie is read raw rather than taken from `authUser` because this guard
    // deliberately runs BEFORE the session guard — a flood must be turned away before it costs
    // a session lookup. An unauthenticated route (login) has no cookie and stays IP-keyed,
    // which is exactly right for a route whose whole purpose is to be hit by strangers.
    const sessionId = request.cookies?.[SESSION_COOKIE];
    const subject = sessionId ? `s:${sessionId}` : `ip:${request.ip}`;
    const bucket = `${context.getClass().name}.${context.getHandler().name}:${subject}`;
    if (await this.lockout.hitRate(bucket, options.limit, options.windowSeconds)) {
      throw AppException.tooManyRequests('common.rate_limited', 'Too many requests');
    }
    return true;
  }
}
