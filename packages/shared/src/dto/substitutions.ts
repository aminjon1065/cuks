import { z } from 'zod';
import { SUBSTITUTION_SCOPES, type SubstitutionScope } from '../enums';

/**
 * Substitutions / deputies (docs/05-auth-rbac.md §6, task 3.11). A principal delegates their
 * route duties to a deputy for a window; while active, the deputy sees and executes the
 * principal's steps and signs «за».
 */
export const createSubstitutionSchema = z
  .object({
    principalId: z.string().uuid(),
    deputyId: z.string().uuid(),
    scope: z.enum(SUBSTITUTION_SCOPES).default('docflow'),
    startsAt: z.string().datetime({ offset: true }).nullish(),
    endsAt: z.string().datetime({ offset: true }).nullish(),
  })
  .superRefine((v, ctx) => {
    if (v.principalId === v.deputyId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['deputyId'],
        message: 'deputy must differ from principal',
      });
    }
    if (v.startsAt && v.endsAt && v.startsAt >= v.endsAt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endsAt'],
        message: 'endsAt must be after startsAt',
      });
    }
  });
export type CreateSubstitutionInput = z.infer<typeof createSubstitutionSchema>;

/** A configured substitution, as shown in the «Замещения» settings / admin list. */
export interface SubstitutionDto {
  id: string;
  principalId: string;
  principalName: string | null;
  deputyId: string;
  deputyName: string | null;
  scope: SubstitutionScope;
  startsAt: string | null;
  endsAt: string | null;
  isActive: boolean;
  /** Whether the window and flag make it effective right now. */
  active: boolean;
  createdAt: string;
}
