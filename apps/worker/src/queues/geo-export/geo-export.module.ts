import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { QUEUE } from '@cuks/shared';
import { GeoExportProcessor } from './geo-export.processor';

/** `geo-export` consumer (docs/modules/10 §6, task 2.8). */
@Module({
  imports: [BullModule.registerQueue({ name: QUEUE.geoExport })],
  providers: [GeoExportProcessor],
})
export class GeoExportModule {}
