import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { QUEUE } from '@cuks/shared';
import { MailService } from './mail.service';

/** Email enqueueing, available app-wide. Actual SMTP send runs in the worker. */
@Global()
@Module({
  imports: [BullModule.registerQueue({ name: QUEUE.email })],
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
