import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { QUEUE } from '@cuks/shared';
import { GeoImportProcessor } from './geo-import.processor';

/** `geo-import` consumer (docs/modules/10 §6, task 2.8). */
@Module({
  imports: [BullModule.registerQueue({ name: QUEUE.geoImport })],
  providers: [GeoImportProcessor],
})
export class GeoImportModule {}
