import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { myTasksQuerySchema, type MyTaskDto, type MyTasksQuery } from '@cuks/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/auth/auth-user';
import { TasksService } from './tasks.service';

/** The personal queue «Мои задачи» (docs/modules/15 §5, task 4.4) — the caller's tasks across all
 *  their projects, plus the overdue count that drives the sidebar badge. */
@ApiTags('tasks')
@RequirePermission('tasks.use')
@Controller('tasks/my')
export class MyTasksController {
  constructor(private readonly tasks: TasksService) {}

  @Get()
  @ApiOperation({ summary: 'My active tasks across all projects (assigned, or watched)' })
  my(
    @Query(new ZodValidationPipe(myTasksQuerySchema)) query: MyTasksQuery,
    @CurrentUser() user: AuthUser,
  ): Promise<MyTaskDto[]> {
    return this.tasks.myTasks(user, query.watching);
  }

  @Get('overdue-count')
  @ApiOperation({ summary: 'Count of my overdue tasks (sidebar badge)' })
  async overdueCount(@CurrentUser() user: AuthUser): Promise<{ count: number }> {
    return { count: await this.tasks.overdueCount(user) };
  }
}
