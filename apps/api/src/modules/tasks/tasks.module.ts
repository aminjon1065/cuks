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

/**
 * Tasks / kanban module (docs/modules/15). Task 4.2 lands the board: projects (with the
 * membership ACL), columns, cards and drag-ordering (fractional index), served as a whole board
 * and mutated with realtime `board:{projectId}` events.
 */
@Module({
  imports: [AuthModule, EventsModule],
  controllers: [ProjectsController, BoardController, CardsController],
  providers: [TasksAclService, ProjectsService, ColumnsService, TasksService],
})
export class TasksModule {}
