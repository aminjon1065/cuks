import { Module } from '@nestjs/common';
import { ChatModule } from '../chat/chat.module';
import { OrgController } from './org.controller';
import { OrgUnitsService } from './org-units.service';
import { PositionsService } from './positions.service';
import { UserPositionsService } from './user-positions.service';

/** Org-structure administration (docs/05 §2, docs/16 §2). */
@Module({
  imports: [ChatModule],
  controllers: [OrgController],
  providers: [OrgUnitsService, PositionsService, UserPositionsService],
  exports: [OrgUnitsService],
})
export class OrgModule {}
