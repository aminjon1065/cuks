import { SetMetadata } from '@nestjs/common';

export const ALLOW_PASSWORD_CHANGE_KEY = 'allowDuringPasswordChange';

/** Allows a route to be used while `must_change_password` is set (docs/05 §1). */
export const AllowDuringPasswordChange = (): MethodDecorator & ClassDecorator =>
  SetMetadata(ALLOW_PASSWORD_CHANGE_KEY, true);
