import { Global, Inject, Module, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createDb, type Database } from '@cuks/db';
import type { WorkerEnv } from '../config/env';

/** Drizzle client token, shared with the api's convention. */
export const DB = 'DB';
const POOL = 'DB_POOL';

@Global()
@Module({
  providers: [
    {
      provide: POOL,
      inject: [ConfigService],
      useFactory: (config: ConfigService<WorkerEnv, true>) =>
        createDb(config.get('DATABASE_URL', { infer: true })),
    },
    {
      provide: DB,
      inject: [POOL],
      useFactory: (handle: ReturnType<typeof createDb>): Database => handle.db,
    },
  ],
  exports: [DB],
})
export class DbModule implements OnModuleDestroy {
  constructor(@Inject(POOL) private readonly handle: ReturnType<typeof createDb>) {}

  async onModuleDestroy(): Promise<void> {
    await this.handle.pool.end();
  }
}
