import { z } from 'zod';

/**
 * People/org-unit directory (task 1.5) — a minimal, authenticated-only lookup
 * for pickers (file sharing now; chat/tasks/docs later). Exposes only display
 * identifiers already visible on the org chart, never sensitive fields.
 */
export const directorySearchSchema = z.object({
  q: z.string().trim().max(120).optional(),
});
export type DirectorySearchQuery = z.infer<typeof directorySearchSchema>;

export interface DirectoryUserDto {
  id: string;
  fullName: string;
  shortName: string;
  username: string;
}

export interface DirectoryOrgUnitDto {
  id: string;
  name: string;
  /** Materialized path — lets a picker indent by depth without another query. */
  path: string;
}
