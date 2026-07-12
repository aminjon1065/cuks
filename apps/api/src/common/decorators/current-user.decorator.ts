import { type ExecutionContext, createParamDecorator } from '@nestjs/common';
import type { AuthenticatedRequest, AuthUser } from '../auth/auth-user';

/** Injects the authenticated user resolved by the SessionGuard. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser | undefined => {
    const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    return request.authUser;
  },
);
