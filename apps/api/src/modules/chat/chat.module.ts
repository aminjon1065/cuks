import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { EventsModule } from '../events/events.module';
import { OrgChannelsService } from './org-channels.service';
import { ChatAclService } from './chat-acl.service';
import { ChannelsService } from './channels.service';
import { MessagesService } from './messages.service';
import { ChatSearchService } from './chat-search.service';
import { ChatNotificationsService } from './chat-notifications.service';
import { IncidentChannelsService } from './incident-channels.service';
import { ChannelsController } from './channels.controller';
import { MessagesController } from './messages.controller';
import { MessageActionsController } from './message-actions.controller';
import { ChatSearchController } from './chat-search.controller';

/**
 * Chat module (docs/modules/13). Task 5.1 lands the data model + auto-provisioned org-unit channels;
 * 5.2 the REST + realtime protocol; 5.3–5.5 the UI, presence and message actions; 5.6 message search,
 * jump-to-message and the incident channel.
 */
@Module({
  imports: [AuthModule, EventsModule],
  controllers: [
    ChannelsController,
    MessagesController,
    MessageActionsController,
    ChatSearchController,
  ],
  providers: [
    OrgChannelsService,
    ChatAclService,
    ChannelsService,
    MessagesService,
    ChatSearchService,
    ChatNotificationsService,
    IncidentChannelsService,
  ],
  exports: [OrgChannelsService],
})
export class ChatModule {}
