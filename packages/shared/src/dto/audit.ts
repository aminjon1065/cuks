import { z } from 'zod';

/**
 * GET /admin/audit — filtered audit-log query (docs/09 §5). `action` is a prefix
 * match (e.g. `auth.` for all auth events); `from`/`to` bound `created_at` (ISO UTC).
 */
export const auditLogQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  actorId: z.string().uuid().optional(),
  action: z.string().min(1).max(100).optional(),
  entityType: z.string().min(1).max(64).optional(),
  entityId: z.string().uuid().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});
export type AuditLogQuery = z.infer<typeof auditLogQuerySchema>;

export interface AuditLogDto {
  id: string;
  actorId: string | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  orgUnitId: string | null;
  ip: string | null;
  userAgent: string | null;
  meta: unknown;
  createdAt: string;
}
