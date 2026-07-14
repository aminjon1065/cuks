import { Global, Inject, Logger, Module, type OnModuleDestroy } from '@nestjs/common';
import { createDb, type Database, type DbHandle } from '@cuks/db';
import { ConfigService } from '../../config/config.service';

/** Injection token for the shared drizzle database. */
export const DB = 'DB';
/** Injection token for the raw node-postgres pool. Needed for the few statements
 *  drizzle cannot express — role management (CREATE ROLE, GRANT), task 2.9. */
export const PG_POOL = 'PG_POOL';
const DB_HANDLE = 'DB_HANDLE';

@Global()
@Module({
  providers: [
    {
      provide: DB_HANDLE,
      useFactory: (config: ConfigService): DbHandle => {
        const logger = new Logger('Database');
        return createDb(config.get('DATABASE_URL'), {}, (err) =>
          logger.error(`pool error: ${err.message}`),
        );
      },
      inject: [ConfigService],
    },
    {
      provide: DB,
      useFactory: (handle: DbHandle): Database => handle.db,
      inject: [DB_HANDLE],
    },
    {
      provide: PG_POOL,
      useFactory: (handle: DbHandle) => handle.pool,
      inject: [DB_HANDLE],
    },
  ],
  exports: [DB, PG_POOL],
})
export class DbModule implements OnModuleDestroy {
  constructor(@Inject(DB_HANDLE) private readonly handle: DbHandle) {}

  async onModuleDestroy(): Promise<void> {
    await this.handle.pool.end();
  }
}
