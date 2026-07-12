import { SetMetadata } from '@nestjs/common';

export const SKIP_SESSION_REFRESH_KEY = 'skipSessionRefresh';

/** Skips the sliding cookie re-issue (e.g. logout, which clears the cookies). */
export const SkipSessionRefresh = (): MethodDecorator & ClassDecorator =>
  SetMetadata(SKIP_SESSION_REFRESH_KEY, true);
