import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module';
import { IncidentsController } from './incidents.controller';
import { IncidentNotificationsService } from './incident-notifications.service';
import { IncidentNotificationOutboxService } from './incident-notification-outbox.service';
import { IncidentsService } from './incidents.service';

@Module({
  imports: [EventsModule],
  controllers: [IncidentsController],
  providers: [IncidentsService, IncidentNotificationsService, IncidentNotificationOutboxService],
})
export class IncidentsModule {}
