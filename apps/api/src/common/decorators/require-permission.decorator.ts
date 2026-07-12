import { SetMetadata } from '@nestjs/common';

export const REQUIRED_PERMISSION_KEY = 'requiredPermission';

/**
 * Requires the given catalog permission (docs/05 §3). The PermissionGuard checks
 * it against the user's CASL ability; superadmin passes everything.
 */
export const RequirePermission = (permission: string): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRED_PERMISSION_KEY, permission);
