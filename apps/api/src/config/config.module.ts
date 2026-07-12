import { Global, Module } from '@nestjs/common';
import { ConfigService } from './config.service';

/** Global config module — fail-fast env validation happens in ConfigService's ctor. */
@Global()
@Module({
  providers: [ConfigService],
  exports: [ConfigService],
})
export class ConfigModule {}
