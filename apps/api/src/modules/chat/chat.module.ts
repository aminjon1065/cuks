import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { EventsModule } from '../events/events.module';
import { OrgChannelsService } from './org-channels.service';
import { ChatAclService } from './chat-acl.service';
import { ChannelsService } from './channels.service';
import { MessagesService } from './messages.service';
import { ChannelsController } from './channels.controller';
import { MessagesController } from './messages.controller';
import { MessageActionsController } from './message-actions.controller';

/**
 * Chat module (docs/modules/13). Task 5.1 lands the data model + auto-provisioned org-unit channels;
 * task 5.2 the REST + realtime protocol (channels, DMs, membership, cursor-paged messages, live
 * `channel:{id}` delivery). UI and reactions/typing/presence arrive in 5.3+.
 */
@Module({
  imports: [AuthModule, EventsModule],
  controllers: [ChannelsController, MessagesController, MessageActionsController],
  providers: [OrgChannelsService, ChatAclService, ChannelsService, MessagesService],
  exports: [OrgChannelsService],
})
export class ChatModule {}
