import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { LockoutService } from '../../modules/auth/lockout.service';
import { THROTTLE_KEY, type ThrottleOptions } from '../decorators/throttle.decorator';
import { AppException } from '../exceptions/app.exception';

/**
 * Enforces `@Throttle(limit, window)` as a per-IP fixed-window limit (docs/09 §1).
 * Keyed on `request.ip`, which is only trustworthy because TRUST_PROXY is not
 * blanket-enabled (see main.ts).
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
    const bucket = `${context.getClass().name}.${context.getHandler().name}:${request.ip}`;
    if (await this.lockout.hitRate(bucket, options.limit, options.windowSeconds)) {
      throw AppException.tooManyRequests('common.rate_limited', 'Too many requests');
    }
    return true;
  }
}
