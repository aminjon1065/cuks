import { Global, Module } from '@nestjs/common';
import { JobMetricsService } from './job-metrics.service';

/**
 * Global so each metered sweep can inject the recorder without its own queue module having to
 * re-import it (same shape as DbModule). Depends on the global RedisModule for the client.
 */
@Global()
@Module({
  providers: [JobMetricsService],
  exports: [JobMetricsService],
})
export class JobMetricsModule {}
