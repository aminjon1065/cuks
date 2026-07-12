import { SetMetadata } from '@nestjs/common';

export const THROTTLE_KEY = 'throttle';

export interface ThrottleOptions {
  limit: number;
  windowSeconds: number;
}

/** Per-IP fixed-window rate limit for a route (docs/09 §1). */
export const Throttle = (limit: number, windowSeconds = 60): MethodDecorator & ClassDecorator =>
  SetMetadata(THROTTLE_KEY, { limit, windowSeconds } satisfies ThrottleOptions);
