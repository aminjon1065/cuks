import { BullModule, InjectQueue } from '@nestjs/bullmq';
import { Injectable, Module, type OnApplicationBootstrap } from '@nestjs/common';
import { Queue } from 'bullmq';
import { QUEUE } from '@cuks/shared';
import { AuditMaintenanceProcessor } from './audit-maintenance.processor';

/** Runs partition provisioning once at boot and monthly thereafter. */
@Injectable()
export class AuditMaintenanceScheduler implements OnApplicationBootstrap {
  constructor(@InjectQueue(QUEUE.auditMaintenance) private readonly queue: Queue) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.queue.add('ensure', {}); // provision immediately on boot
    await this.queue.add('ensure', {}, { repeat: { pattern: '0 3 1 * *' } }); // monthly
  }
}

@Module({
  imports: [BullModule.registerQueue({ name: QUEUE.auditMaintenance })],
  providers: [AuditMaintenanceProcessor, AuditMaintenanceScheduler],
})
export class AuditMaintenanceModule {}
