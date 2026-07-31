import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  documentSearchQuerySchema,
  type DocumentSearchHitDto,
  type DocumentSearchQuery,
  type PaginatedResult,
  type QuickSearchHitDto,
} from '@cuks/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { Throttle } from '../../common/decorators/throttle.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/auth/auth-user';
import { DocumentSearchService } from './document-search.service';

/** Cmd+K sends a keystroke at a time, so its own budget is wider than the full search's. */
const SEARCH_PER_MINUTE = 60;
const QUICK_PER_MINUTE = 120;

const quickQuerySchema = z.object({ q: z.string().trim().min(1).max(200) });

/**
 * Search over the register (plan §7.8, docs/09 §1 «отдельно — глобальный поиск»).
 *
 * Rate-limited on its own budget rather than the general read allowance: search is the most
 * expensive read in the product and the most useful one to a scraper, and — because it answers
 * «сколько всего» — the one where a flood of narrow queries could be used to probe for what
 * exists. The limit is per session, so one busy user cannot spend the whole office's budget.
 */
@ApiTags('docflow')
@Controller('docflow')
export class DocumentSearchController {
  constructor(private readonly search: DocumentSearchService) {}

  @Get('search')
  @RequirePermission('docflow.use')
  @Throttle(SEARCH_PER_MINUTE)
  @ApiOperation({ summary: 'Full-text search over the documents the caller may see' })
  find(
    @Query(new ZodValidationPipe(documentSearchQuerySchema)) query: DocumentSearchQuery,
    @CurrentUser() user: AuthUser,
  ): Promise<PaginatedResult<DocumentSearchHitDto>> {
    return this.search.search(query, user);
  }

  @Get('search/quick')
  @RequirePermission('docflow.use')
  @Throttle(QUICK_PER_MINUTE)
  @ApiOperation({ summary: 'Command palette: at most five visible documents' })
  quick(
    @Query(new ZodValidationPipe(quickQuerySchema)) query: { q: string },
    @CurrentUser() user: AuthUser,
  ): Promise<QuickSearchHitDto[]> {
    return this.search.quick(query.q, user);
  }
}
