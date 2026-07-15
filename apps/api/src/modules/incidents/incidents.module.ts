import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module';
import { EventsModule } from '../events/events.module';
import { IncidentsController } from './incidents.controller';
import { IncidentNotificationsService } from './incident-notifications.service';
import { IncidentNotificationOutboxService } from './incident-notification-outbox.service';
import { IncidentsService } from './incidents.service';

@Module({
  imports: [EventsModule, AdminModule],
  controllers: [IncidentsController],
  providers: [IncidentsService, IncidentNotificationsService, IncidentNotificationOutboxService],
})
export class IncidentsModule {}
