import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { chatSearchSchema, type ChatSearchPage, type ChatSearchQuery } from '@cuks/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/auth/auth-user';
import { ChatSearchService } from './chat-search.service';

/** Full-text message search (docs/modules/13 §8, task 5.6). */
@ApiTags('chat')
@RequirePermission('chat.use')
@Controller('chat/search')
export class ChatSearchController {
  constructor(private readonly search: ChatSearchService) {}

  @Get()
  @ApiOperation({ summary: 'Search my conversations by text, channel, author and period' })
  run(
    @Query(new ZodValidationPipe(chatSearchSchema)) query: ChatSearchQuery,
    @CurrentUser() user: AuthUser,
  ): Promise<ChatSearchPage> {
    return this.search.search(query, user);
  }
}
