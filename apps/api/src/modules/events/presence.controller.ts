import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { presenceQuerySchema, type PresenceQuery, type PresenceStatusDto } from '@cuks/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { PresenceService } from './presence.service';

/**
 * Bulk presence lookup for avatars / member lists (docs/modules/13 §4). Authenticated-only — like
 * the directory, presence of colleagues is org-chart-level information, not a secret. Live
 * transitions arrive via the `presence.changed` WS broadcast; this endpoint seeds the map.
 */
@ApiTags('presence')
@Controller('presence')
export class PresenceController {
  constructor(private readonly presence: PresenceService) {}

  @Get()
  statuses(
    @Query(new ZodValidationPipe(presenceQuerySchema)) query: PresenceQuery,
  ): Promise<PresenceStatusDto[]> {
    return this.presence.statusOf(query.userIds);
  }
}
