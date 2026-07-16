import { Module } from '@nestjs/common';
import { OrgChannelsService } from './org-channels.service';

/**
 * Chat module (docs/modules/13). Task 5.1 lands the data model plus auto-provisioning of org-unit
 * channels; the REST/WS protocol and UI arrive in 5.2+.
 */
@Module({
  providers: [OrgChannelsService],
  exports: [OrgChannelsService],
})
export class ChatModule {}
