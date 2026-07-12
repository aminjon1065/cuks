import { z } from 'zod';
import { PASSWORD_MIN_LENGTH } from '../constants/index';

/** POST /auth/login (docs/05 §1). `totp` is a 6-digit code or an 8-char backup code. */
export const loginSchema = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(256),
  totp: z.string().min(6).max(16).optional(),
  remember: z.boolean().optional().default(false),
});
export type LoginInput = z.infer<typeof loginSchema>;

/** POST /auth/password (docs/05 §1). */
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(256),
  newPassword: z.string().min(PASSWORD_MIN_LENGTH).max(256),
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

/** POST /auth/totp/confirm and /auth/totp/disable — a 6-digit code. */
export const totpCodeSchema = z.object({
  code: z.string().regex(/^\d{6}$/, 'expected a 6-digit code'),
});
export type TotpCodeInput = z.infer<typeof totpCodeSchema>;

/** Org context surfaced in GET /auth/me. */
export interface OrgContext {
  positionId: string;
  positionName: string;
  orgUnitId: string;
  orgUnitName: string;
  isPrimary: boolean;
  isHead: boolean;
}

/** GET /auth/me response — profile, packed ability rules, org context. */
export interface MeResponse {
  id: string;
  username: string;
  fullName: string;
  shortName: string;
  email: string | null;
  locale: 'ru' | 'tg';
  theme: 'system' | 'light' | 'dark';
  totpEnabled: boolean;
  totpRequired: boolean;
  mustChangePassword: boolean;
  permissions: string[];
  isSuperadmin: boolean;
  /** Serialized CASL rules — the frontend rebuilds the same ability. */
  abilityRules: unknown[];
  orgContext: OrgContext[];
}

/** GET /auth/sessions item. */
export interface SessionInfo {
  id: string;
  current: boolean;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
  lastActivityAt: string;
}
