import { Module } from '@nestjs/common';
import { LivekitService } from './livekit.service';
import { MeetRoomsController } from './meet-rooms.controller';
import { MeetRoomsService } from './meet-rooms.service';
import { MeetWebhookController } from './meet-webhook.controller';
import { MeetWebhookService } from './meet-webhook.service';

/**
 * Calls/conferences (docs/modules/14). Task 6.1 landed the LiveKit plumbing (webhook receiver + SDK
 * wrapper); task 6.2 adds call rooms and the join-token service. Meetings and recordings follow in
 * later tasks. LivekitService is exported for them to reuse.
 */
@Module({
  controllers: [MeetWebhookController, MeetRoomsController],
  providers: [LivekitService, MeetWebhookService, MeetRoomsService],
  exports: [LivekitService],
})
export class MeetModule {}
