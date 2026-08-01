import { Module } from '@nestjs/common';
import { HealthModule } from '../health/health.module';
import { EventsModule } from '../events/events.module';
import { AdminHealthController } from './admin-health.controller';
import { AdminHealthService } from './admin-health.service';
import { MetricsService } from './metrics.service';
import { MonitoringAlertController } from './monitoring-alert.controller';
import { MonitoringAlertService } from './monitoring-alert.service';
import { ExchangeRegistryService } from '../docflow/exchange/exchange-registry.service';
import { QueueStatsService } from './queue-stats.service';

/**
 * Monitoring (task 7.3): the admin health dashboard (docs/modules/16 §7), the app error metric, and the
 * inbound Uptime Kuma alert webhook. MetricsService is exported so the global exception filter can record
 * 5xx errors into it.
 */
@Module({
  imports: [HealthModule, EventsModule],
  controllers: [AdminHealthController, MonitoringAlertController],
  providers: [
    AdminHealthService,
    QueueStatsService,
    MetricsService,
    MonitoringAlertService,
    // Provided rather than imported from DocflowModule: it reads only configuration, and
    // importing the whole docflow module into monitoring would close a dependency cycle.
    ExchangeRegistryService,
  ],
  exports: [MetricsService],
})
export class MonitoringModule {}
