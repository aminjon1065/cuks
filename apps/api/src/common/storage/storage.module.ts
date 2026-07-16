import { Global, Logger, Module, type OnModuleInit } from '@nestjs/common';
import { S3Client } from '@aws-sdk/client-s3';
import { ConfigService } from '../../config/config.service';
import { StorageService } from './storage.service';
import { S3, S3_PUBLIC } from './storage.tokens';

const s3ClientFor = (config: ConfigService, endpoint: string): S3Client =>
  new S3Client({
    endpoint,
    region: config.get('S3_REGION'),
    // MinIO is not a real AWS region — path-style addressing (vs. virtual-hosted
    // bucket subdomains) is required for it to resolve buckets correctly.
    forcePathStyle: true,
    credentials: {
      accessKeyId: config.get('S3_ACCESS_KEY'),
      secretAccessKey: config.get('S3_SECRET_KEY'),
    },
  });

@Global()
@Module({
  providers: [
    {
      provide: S3,
      useFactory: (config: ConfigService): S3Client =>
        s3ClientFor(config, config.get('S3_ENDPOINT')),
      inject: [ConfigService],
    },
    {
      // Presigning-only client (see S3_PUBLIC). Falls back to the internal endpoint when
      // S3_PUBLIC_ENDPOINT is unset, so dev and same-origin prod behave exactly as before.
      provide: S3_PUBLIC,
      useFactory: (config: ConfigService): S3Client =>
        s3ClientFor(config, config.get('S3_PUBLIC_ENDPOINT') ?? config.get('S3_ENDPOINT')),
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
