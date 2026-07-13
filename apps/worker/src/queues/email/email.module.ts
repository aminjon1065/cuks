import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { QUEUE } from '@cuks/shared';
import { EmailProcessor } from './email.processor';

@Module({
  imports: [BullModule.registerQueue({ name: QUEUE.email })],
  providers: [EmailProcessor],
})
export class EmailModule {}
