import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { QUEUE } from '@cuks/shared';
import { AvScanProcessor } from './av-scan.processor';

@Module({
  imports: [
    // Consumer of av-scan; producer for the two follow-up jobs it chains on a
    // clean verdict (docs/modules/12 §8: scan → preview/text-extract pipeline).
    BullModule.registerQueue({ name: QUEUE.avScan }),
    BullModule.registerQueue({ name: QUEUE.preview }),
    BullModule.registerQueue({ name: QUEUE.textExtract }),
  ],
  providers: [AvScanProcessor],
})
export class AvScanModule {}
