import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client } from '@aws-sdk/client-s3';
import type { WorkerEnv } from '../config/env';
import { S3 } from './storage.tokens';
import { StorageService } from './storage.service';

@Global()
@Module({
  providers: [
    {
      provide: S3,
      inject: [ConfigService],
      useFactory: (config: ConfigService<WorkerEnv, true>): S3Client =>
        new S3Client({
          endpoint: config.get('S3_ENDPOINT', { infer: true }),
          region: config.get('S3_REGION', { infer: true }),
          forcePathStyle: true,
          credentials: {
            accessKeyId: config.get('S3_ACCESS_KEY', { infer: true }),
            secretAccessKey: config.get('S3_SECRET_KEY', { infer: true }),
          },
        }),
    },
    StorageService,
  ],
  exports: [StorageService],
})
export class StorageModule {}
