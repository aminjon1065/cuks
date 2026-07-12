import { z } from 'zod';
import { DEFAULT_PAGE, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '../constants/index';

/**
 * Page-based pagination query for table lists (docs/04 §Pagination):
 * `?page=1&limit=50` (limit capped at 200).
 */
export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(DEFAULT_PAGE),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

/** Paged response envelope: `{ items, total, page, limit }`. */
export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

/**
 * Cursor pagination for infinite feeds (chat, audit, activity — docs/04):
 * `?cursor=<uuidv7>&limit=50`, response `{ items, nextCursor }`.
 */
export const cursorQuerySchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});

export type CursorQuery = z.infer<typeof cursorQuerySchema>;

export interface CursorResult<T> {
  items: T[];
  nextCursor: string | null;
}
