import { Body, Controller, Param, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  moveTaskSchema,
  updateTaskSchema,
  type MoveTaskInput,
  type TaskCardDto,
  type UpdateTaskInput,
} from '@cuks/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/auth/auth-user';
import { TasksService } from './tasks.service';

const uuidSchema = z.string().uuid();

/** Card-scoped operations (docs/modules/15 §3/§4, task 4.2) — edit, drag-move and archive. */
@ApiTags('tasks')
@Controller('tasks/cards')
export class CardsController {
  constructor(private readonly tasks: TasksService) {}

  @Patch(':id')
  @RequirePermission('tasks.use')
  @ApiOperation({ summary: 'Edit a card (editor)' })
  update(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(updateTaskSchema)) body: UpdateTaskInput,
    @CurrentUser() user: AuthUser,
  ): Promise<TaskCardDto> {
    return this.tasks.updateCard(id, body, user);
  }

  @Post(':id/move')
  @RequirePermission('tasks.use')
  @ApiOperation({ summary: 'Move a card into a column at a position (editor)' })
  move(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(moveTaskSchema)) body: MoveTaskInput,
    @CurrentUser() user: AuthUser,
  ): Promise<TaskCardDto> {
    return this.tasks.moveCard(id, body, user);
  }

  @Post(':id/archive')
  @RequirePermission('tasks.use')
  @ApiOperation({ summary: 'Archive a card (editor)' })
  archive(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<void> {
    return this.tasks.archiveCard(id, user);
  }
}
