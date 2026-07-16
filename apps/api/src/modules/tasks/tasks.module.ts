import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { EventsModule } from '../events/events.module';
import { ProjectsController } from './projects.controller';
import { BoardController } from './board.controller';
import { CardsController } from './cards.controller';
import { TasksAclService } from './tasks-acl.service';
import { ProjectsService } from './projects.service';
import { ColumnsService } from './columns.service';
import { TasksService } from './tasks.service';
import { ChecklistService } from './checklist.service';
import { TaskCommentsService } from './comments.service';

/**
 * Tasks / kanban module (docs/modules/15). Task 4.2 lands the board (projects with the membership
 * ACL, columns, cards, drag-ordering); task 4.3 adds the card SidePanel — full-card read, per-field
 * edit history, checklist, comments-with-mentions and the «История» trail, over `board:{projectId}`
 * realtime and NotificationsService (assign / mention / status).
 */
@Module({
  imports: [AuthModule, EventsModule],
  controllers: [ProjectsController, BoardController, CardsController],
  providers: [
    TasksAclService,
    ProjectsService,
    ColumnsService,
    TasksService,
    ChecklistService,
    TaskCommentsService,
  ],
})
export class TasksModule {}
