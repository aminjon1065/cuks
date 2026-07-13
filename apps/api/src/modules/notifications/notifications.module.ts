import { Global, Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

/**
 * Notifications core. Global (like AuditService) so any module can inject
 * {@link NotificationsService}.notify() to emit — without an import cycle through
 * EventsModule ← AuthModule.
 */
@Global()
@Module({
  imports: [EventsModule],
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
