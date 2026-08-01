import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, isNull, or } from 'drizzle-orm';
import { savedFilters, users, type Database } from '@cuks/db';
import {
  DOCFLOW_VIEW_MODULE,
  DOCUMENT_VIEW_PARAMS,
  type DocumentViewParam,
  type DocumentViewDto,
  type SaveDocumentViewInput,
  type UpdateDocumentViewInput,
} from '@cuks/shared';
import type { AuthUser } from '../../common/auth/auth-user';
import { AppException } from '../../common/exceptions/app.exception';
import { DB } from '../../common/db/db.module';

/** How many presets one person may keep. A bound, not a policy — an unbounded list stops
 *  being a shortcut somewhere around thirty, and the column is jsonb. */
const MAX_VIEWS_PER_USER = 50;

/**
 * Saved register views (plan этап 9).
 *
 * Stored in the SHARED `app.saved_filters` table under a module discriminator, exactly as the
 * incident registry and the analytics report builder already do (docs/07 §saved_filters). A
 * `docflow.saved_searches` table of its own would have been a third copy of the same four
 * columns, with its own soft-delete and its own bugs.
 *
 * A view holds FILTERS, never rows or ids of rows. That is what makes sharing safe: the list a
 * shared preset opens is built with the VIEWER's visibility, so «Все ДСП за март» shows each
 * colleague only the ones they are admitted to, and shows a colleague with no clearance
 * nothing at all. Nothing about the preset itself discloses what it would match.
 */
@Injectable()
export class DocumentViewsService {
  constructor(@Inject(DB) private readonly db: Database) {}

  /** The caller's own views plus everything shared, newest first, own ones on top. */
  async list(actor: AuthUser): Promise<DocumentViewDto[]> {
    const rows = await this.db
      .select({
        id: savedFilters.id,
        name: savedFilters.name,
        params: savedFilters.params,
        isShared: savedFilters.isShared,
        userId: savedFilters.userId,
        ownerName: users.shortName,
        createdAt: savedFilters.createdAt,
      })
      .from(savedFilters)
      .leftJoin(users, eq(users.id, savedFilters.userId))
      .where(
        and(
          eq(savedFilters.module, DOCFLOW_VIEW_MODULE),
          isNull(savedFilters.deletedAt),
          or(eq(savedFilters.userId, actor.id), eq(savedFilters.isShared, true)),
        ),
      )
      .orderBy(desc(savedFilters.createdAt));

    return (
      rows
        .map((r) => this.toDto(r, actor))
        // One's own presets first: they are the ones a person reaches for, and a colleague's
        // shared view arriving above them turns a shortcut into a search.
        .sort((a, b) => Number(b.canManage) - Number(a.canManage))
    );
  }

  async create(input: SaveDocumentViewInput, actor: AuthUser): Promise<DocumentViewDto> {
    const mine = await this.db
      .select({ id: savedFilters.id })
      .from(savedFilters)
      .where(
        and(
          eq(savedFilters.module, DOCFLOW_VIEW_MODULE),
          eq(savedFilters.userId, actor.id),
          isNull(savedFilters.deletedAt),
        ),
      );
    if (mine.length >= MAX_VIEWS_PER_USER) {
      throw AppException.unprocessable(
        'docflow.view.too_many',
        'You already have the maximum number of saved views',
        { limit: MAX_VIEWS_PER_USER },
      );
    }
    const [row] = await this.db
      .insert(savedFilters)
      .values({
        userId: actor.id,
        module: DOCFLOW_VIEW_MODULE,
        name: input.name,
        params: input.params,
        isShared: input.isShared,
      })
      .returning();
    if (!row) throw new Error('Saved view insert did not return a row');
    return this.toDto({ ...row, ownerName: null }, actor);
  }

  /**
   * Rename, re-save the filters, or change sharing — only on one's own view. A colleague's
   * shared preset is read-only: it is offered as a convenience, not handed over.
   */
  async update(
    id: string,
    input: UpdateDocumentViewInput,
    actor: AuthUser,
  ): Promise<DocumentViewDto> {
    const [row] = await this.db
      .update(savedFilters)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.params !== undefined ? { params: input.params } : {}),
        ...(input.isShared !== undefined ? { isShared: input.isShared } : {}),
        updatedAt: new Date(),
      })
      // Ownership is part of the predicate rather than a check before it: read-then-write
      // would let a concurrent delete slip between the two.
      .where(
        and(
          eq(savedFilters.id, id),
          eq(savedFilters.module, DOCFLOW_VIEW_MODULE),
          eq(savedFilters.userId, actor.id),
          isNull(savedFilters.deletedAt),
        ),
      )
      .returning();
    if (!row) throw AppException.notFound('docflow.view.not_found', 'Saved view not found');
    return this.toDto({ ...row, ownerName: null }, actor);
  }

  async remove(id: string, actor: AuthUser): Promise<void> {
    const [row] = await this.db
      .update(savedFilters)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(savedFilters.id, id),
          eq(savedFilters.module, DOCFLOW_VIEW_MODULE),
          eq(savedFilters.userId, actor.id),
          isNull(savedFilters.deletedAt),
        ),
      )
      .returning({ id: savedFilters.id });
    if (!row) throw AppException.notFound('docflow.view.not_found', 'Saved view not found');
  }

  private toDto(
    row: {
      id: string;
      name: string;
      params: unknown;
      isShared: boolean;
      userId: string;
      ownerName?: string | null;
      createdAt: Date;
    },
    actor: AuthUser,
  ): DocumentViewDto {
    const mine = row.userId === actor.id;
    return {
      id: row.id,
      name: row.name,
      // Re-checked on the way OUT as well as in: the column is jsonb and this row may predate
      // the current allow-list, and a preset is only ever pasted into a URL.
      params: sanitizeParams(row.params),
      isShared: row.isShared,
      ownerName: mine ? null : (row.ownerName ?? null),
      canManage: mine,
      createdAt: row.createdAt.toISOString(),
    };
  }
}

/** Keep only short string values under allow-listed keys; anything else was never a filter. */
function sanitizeParams(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!DOCUMENT_VIEW_PARAMS.includes(key as DocumentViewParam)) continue;
    if (typeof value === 'string' && value.length <= 200) out[key] = value;
  }
  return out;
}
