import { SetMetadata } from '@nestjs/common';

export const ALLOW_TOTP_ENROLLMENT_KEY = 'allowDuringTotpEnrollment';

/** Allows a route while a privileged user still has to enroll TOTP (docs/05 §1). */
export const AllowDuringTotpEnrollment = (): MethodDecorator & ClassDecorator =>
  SetMetadata(ALLOW_TOTP_ENROLLMENT_KEY, true);
