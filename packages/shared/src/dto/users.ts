import { z } from 'zod';
import { USER_STATUSES } from '../enums/index';

/** GET /admin/users — paged, filtered user list (docs/16 §1). */
export const listUsersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().trim().min(1).max(100).optional(),
  status: z.enum(USER_STATUSES).optional(),
});
export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;

export interface UserListItemDto {
  id: string;
  username: string;
  fullName: string;
  shortName: string;
  email: string | null;
  status: (typeof USER_STATUSES)[number];
  totpEnabled: boolean;
  lastLoginAt: string | null;
  primaryPosition: string | null;
  roles: string[];
}

export interface UserPositionSummary {
  id: string;
  positionId: string;
  positionName: string;
  orgUnitId: string;
  orgUnitName: string;
  isPrimary: boolean;
}

export interface UserRoleSummary {
  id: string;
  roleId: string;
  roleName: string;
  orgUnitId: string | null;
  orgUnitName: string | null;
}

export interface UserDetailDto {
  id: string;
  username: string;
  fullName: string;
  shortName: string;
  email: string | null;
  phone: string | null;
  status: (typeof USER_STATUSES)[number];
  totpEnabled: boolean;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  positions: UserPositionSummary[];
  roles: UserRoleSummary[];
}

/** POST /admin/users. Username + a one-time password are generated server-side. */
export const createUserSchema = z.object({
  fullName: z.string().trim().min(3).max(160),
  email: z.string().email().max(160).optional(),
  phone: z.string().trim().max(32).optional(),
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateUserSchema = z.object({
  fullName: z.string().trim().min(3).max(160).optional(),
  email: z.string().email().max(160).nullish(),
  phone: z.string().trim().max(32).nullish(),
});
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

/** Returned once on create / password reset — the plaintext temp password. */
export interface TempPasswordDto {
  id: string;
  username: string;
  tempPassword: string;
}
