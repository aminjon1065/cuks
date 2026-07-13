import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { DEFAULT_JOB_OPTIONS } from '@cuks/shared';
import { DbModule } from './common/db.module';
import { StorageModule } from './common/storage.module';
import { validateEnv, type WorkerEnv } from './config/env';
import { AuditMaintenanceModule } from './queues/audit-maintenance/audit-maintenance.module';
import { AvScanModule } from './queues/av-scan/av-scan.module';
import { DeadlinesModule } from './queues/deadlines/deadlines.module';
import { EmailModule } from './queues/email/email.module';
import { PreviewModule } from './queues/preview/preview.module';
import { RetentionModule } from './queues/retention/retention.module';
import { TextExtractModule } from './queues/text-extract/text-extract.module';

/**
 * Worker root (docs/01 §Фоновые задачи). Consumes BullMQ queues off the same Redis
 * as the api. Phase 0.13 wired the connection + `email`/`deadlines`/
 * `audit-maintenance`; phase 1.3 adds the files pipeline (av-scan/preview/
 * text-extract/retention) with its own S3 client (StorageModule — no cross-app
 * import from apps/api, same precedent as the DB pool/mail transport).
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
    StorageModule,
    EmailModule,
    DeadlinesModule,
    AuditMaintenanceModule,
    AvScanModule,
    PreviewModule,
    TextExtractModule,
    RetentionModule,
  ],
})
export class AppModule {}
