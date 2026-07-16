import { Module } from '@nestjs/common';
import { LivekitService } from './livekit.service';
import { MeetWebhookController } from './meet-webhook.controller';
import { MeetWebhookService } from './meet-webhook.service';

/**
 * Calls/conferences (docs/modules/14). Task 6.1 lands the LiveKit plumbing: the
 * webhook receiver and the SDK wrapper. Token endpoints, rooms and recordings are
 * added in later tasks; LivekitService is exported for them to reuse.
 */
@Module({
  controllers: [MeetWebhookController],
  providers: [LivekitService, MeetWebhookService],
  exports: [LivekitService],
})
export class MeetModule {}
