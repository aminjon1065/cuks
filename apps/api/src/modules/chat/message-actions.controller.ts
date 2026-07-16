import { Body, Controller, Delete, Param, Patch, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  editMessageSchema,
  reactionSchema,
  type EditMessageInput,
  type MessageDto,
  type ReactionInput,
} from '@cuks/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/auth/auth-user';
import { MessagesService } from './messages.service';

const uuidPipe = new ZodValidationPipe(z.string().uuid());

/** Per-message actions (docs/modules/13 §8, task 5.5): edit, soft delete, reaction toggle. */
@ApiTags('chat')
@RequirePermission('chat.use')
@Controller('chat/messages')
export class MessageActionsController {
  constructor(private readonly messages: MessagesService) {}

  @Patch(':id')
  @ApiOperation({ summary: 'Edit a message — author only, within 24h' })
  edit(
    @Param('id', uuidPipe) id: string,
    @Body(new ZodValidationPipe(editMessageSchema)) body: EditMessageInput,
    @CurrentUser() user: AuthUser,
  ): Promise<MessageDto> {
    return this.messages.edit(id, body, user);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a message — author, or channel admin (tombstone)' })
  remove(@Param('id', uuidPipe) id: string, @CurrentUser() user: AuthUser): Promise<void> {
    return this.messages.remove(id, user);
  }

  @Put(':id/reactions')
  @ApiOperation({ summary: 'Toggle a palette reaction (member)' })
  react(
    @Param('id', uuidPipe) id: string,
    @Body(new ZodValidationPipe(reactionSchema)) body: ReactionInput,
    @CurrentUser() user: AuthUser,
  ): Promise<void> {
    return this.messages.toggleReaction(id, body.emoji, user);
  }
}
