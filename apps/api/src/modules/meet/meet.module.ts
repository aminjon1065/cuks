import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QUEUE } from '@cuks/shared';
import { EventsModule } from '../events/events.module';
import { LivekitService } from './livekit.service';
import { MeetReminderProcessor } from './meet-reminder.processor';
import { MeetRingController } from './meet-ring.controller';
import { MeetRingProcessor } from './meet-ring.processor';
import { MeetRoomsController } from './meet-rooms.controller';
import { MeetRoomsService } from './meet-rooms.service';
import { MeetSystemMessagesService } from './meet-system-messages.service';
import { MeetWebhookController } from './meet-webhook.controller';
import { MeetWebhookService } from './meet-webhook.service';
import { MeetingsController } from './meetings.controller';
import { MeetingsService } from './meetings.service';
import { RingService } from './ring.service';

/**
 * Calls/conferences (docs/modules/14). 6.1 landed the LiveKit plumbing (webhook + SDK wrapper); 6.2
 * added call rooms + the join-token service; 6.3 host moderation; 6.4 the 1:1 ring-flow, channel call
 * banner and call system messages. The `meet-ring` timeout job is consumed here (in the API process)
 * so it can emit realtime events. LivekitService is exported for later tasks to reuse.
 */
@Module({
  imports: [
    EventsModule,
    BullModule.registerQueue({ name: QUEUE.meetRing }, { name: QUEUE.meetReminder }),
  ],
  controllers: [MeetWebhookController, MeetRoomsController, MeetRingController, MeetingsController],
  providers: [
    LivekitService,
    MeetWebhookService,
    MeetRoomsService,
    MeetSystemMessagesService,
    RingService,
    MeetRingProcessor,
    MeetingsService,
    MeetReminderProcessor,
  ],
  exports: [LivekitService],
})
export class MeetModule {}
