import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { EventsGateway } from './events.gateway';
import { RealtimeService } from './realtime.service';
import { PresenceService } from './presence.service';
import { PresenceController } from './presence.controller';

/**
 * Realtime module (docs/01 §Realtime): the `/ws` gateway plus {@link RealtimeService},
 * which other modules inject to push events. The Redis adapter is installed in
 * `main.ts` so events fan out across api processes.
 */
@Module({
  imports: [AuthModule, UsersModule],
  controllers: [PresenceController],
  providers: [EventsGateway, RealtimeService, PresenceService],
  exports: [RealtimeService, PresenceService],
})
export class EventsModule {}
