import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { QUEUE } from '@cuks/shared';
import { PreviewProcessor } from './preview.processor';

@Module({
  imports: [BullModule.registerQueue({ name: QUEUE.preview })],
  providers: [PreviewProcessor],
})
export class PreviewModule {}
