import { Global, Inject, Logger, Module, type OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { ConfigService } from '../../config/config.service';

/** Injection token for the shared ioredis client. */
export const REDIS = 'REDIS_CLIENT';

@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      useFactory: (config: ConfigService): Redis => {
        const client = new Redis(config.get('REDIS_URL'));
        const logger = new Logger('Redis');
        // Prevent an unhandled 'error' event from crashing the process when Redis
        // is briefly unavailable; ioredis reconnects on its own.
        client.on('error', (err: Error) => logger.error(`redis error: ${err.message}`));
        return client;
      },
      inject: [ConfigService],
    },
  ],
  exports: [REDIS],
})
export class RedisModule implements OnModuleDestroy {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async onModuleDestroy(): Promise<void> {
    await this.redis.quit();
  }
}
