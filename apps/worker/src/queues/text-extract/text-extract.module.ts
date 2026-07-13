import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { QUEUE } from '@cuks/shared';
import { TextExtractProcessor } from './text-extract.processor';

@Module({
  imports: [BullModule.registerQueue({ name: QUEUE.textExtract })],
  providers: [TextExtractProcessor],
})
export class TextExtractModule {}
