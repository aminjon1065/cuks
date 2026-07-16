import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  messagesQuerySchema,
  sendMessageSchema,
  type MessageDto,
  type MessagesPage,
  type MessagesQuery,
  type SendMessageInput,
} from '@cuks/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/auth/auth-user';
import { MessagesService } from './messages.service';

const uuidPipe = new ZodValidationPipe(z.string().uuid());

/** Channel message history + sending (docs/modules/13 §8, task 5.2). */
@ApiTags('chat')
@RequirePermission('chat.use')
@Controller('chat/channels')
export class MessagesController {
  constructor(private readonly messages: MessagesService) {}

  @Get(':id/messages')
  @ApiOperation({ summary: 'Message history — cursor-paged upward (member)' })
  list(
    @Param('id', uuidPipe) id: string,
    @Query(new ZodValidationPipe(messagesQuerySchema)) query: MessagesQuery,
    @CurrentUser() user: AuthUser,
  ): Promise<MessagesPage> {
    return this.messages.list(id, query, user);
  }

  @Post(':id/messages')
  @ApiOperation({ summary: 'Send a message (member)' })
  send(
    @Param('id', uuidPipe) id: string,
    @Body(new ZodValidationPipe(sendMessageSchema)) body: SendMessageInput,
    @CurrentUser() user: AuthUser,
  ): Promise<MessageDto> {
    return this.messages.send(id, body, user);
  }
}
