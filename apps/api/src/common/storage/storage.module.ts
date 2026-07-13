import { Global, Logger, Module, type OnModuleInit } from '@nestjs/common';
import { S3Client } from '@aws-sdk/client-s3';
import { ConfigService } from '../../config/config.service';
import { StorageService } from './storage.service';
import { S3 } from './storage.tokens';

@Global()
@Module({
  providers: [
    {
      provide: S3,
      useFactory: (config: ConfigService): S3Client =>
        new S3Client({
          endpoint: config.get('S3_ENDPOINT'),
          region: config.get('S3_REGION'),
          // MinIO is not a real AWS region — path-style addressing (vs. virtual-hosted
          // bucket subdomains) is required for it to resolve buckets correctly.
          forcePathStyle: true,
          credentials: {
            accessKeyId: config.get('S3_ACCESS_KEY'),
            secretAccessKey: config.get('S3_SECRET_KEY'),
          },
        }),
      inject: [ConfigService],
    },
    StorageService,
  ],
  exports: [StorageService],
})
export class StorageModule implements OnModuleInit {
  private readonly logger = new Logger(StorageModule.name);

  constructor(private readonly storage: StorageService) {}

  // Best-effort: MinIO being briefly unreachable at boot (slow `docker compose
  // up`, rolling restart) must not crash the whole API, same as the Redis/DB
  // pool error handlers (docs/plan/STATUS.md 0.1-0.2 review). Upload/download
  // calls will surface a clear error later if the bucket still doesn't exist.
  async onModuleInit(): Promise<void> {
    try {
      await this.storage.ensureBucket();
    } catch (err) {
      this.logger.error({ err }, 'failed to ensure the storage bucket exists at boot');
    }
  }
}
