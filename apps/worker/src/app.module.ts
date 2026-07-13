import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { DEFAULT_JOB_OPTIONS } from '@cuks/shared';
import { DbModule } from './common/db.module';
import { validateEnv, type WorkerEnv } from './config/env';
import { AuditMaintenanceModule } from './queues/audit-maintenance/audit-maintenance.module';
import { DeadlinesModule } from './queues/deadlines/deadlines.module';
import { EmailModule } from './queues/email/email.module';

/**
 * Worker root (docs/01 §Фоновые задачи). Consumes BullMQ queues off the same Redis
 * as the api. Phase 0.13 wires the connection + the `email`, `deadlines` and
 * `audit-maintenance` queues; the rest (av-scan, preview, geo, …) land per phase.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<WorkerEnv, true>) => ({
        connection: {
          url: config.get('REDIS_URL', { infer: true }),
          maxRetriesPerRequest: null,
        },
        defaultJobOptions: DEFAULT_JOB_OPTIONS,
      }),
    }),
    DbModule,
    EmailModule,
    DeadlinesModule,
    AuditMaintenanceModule,
  ],
})
export class AppModule {}
