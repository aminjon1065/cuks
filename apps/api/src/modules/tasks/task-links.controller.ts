import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  TASK_LINK_TARGETS,
  createLinkedCardSchema,
  type CreateLinkedCardInput,
  type LinkedTaskDto,
  type TaskCardDto,
  type TaskLinkTarget,
} from '@cuks/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/auth/auth-user';
import { EntityLinksService } from './entity-links.service';

const uuidSchema = z.string().uuid();
const targetTypeSchema = z.enum(TASK_LINK_TARGETS);

/** Cross-module task links (docs/modules/15 §6, task 4.5): create a card already linked to a ЧС /
 *  document, and list the tasks linked to a given entity (for its card). */
@ApiTags('tasks')
@RequirePermission('tasks.use')
@Controller('tasks')
export class TaskLinksController {
  constructor(private readonly links: EntityLinksService) {}

  @Post('cards/linked')
  @ApiOperation({ summary: 'Create a card and link it to a ЧС / document (editor of the project)' })
  createLinked(
    @Body(new ZodValidationPipe(createLinkedCardSchema)) body: CreateLinkedCardInput,
    @CurrentUser() user: AuthUser,
  ): Promise<TaskCardDto> {
    return this.links.createLinkedCard(body, user);
  }

  @Get('linked/:targetType/:targetId')
  @ApiOperation({ summary: 'Tasks linked to a ЧС / document (my projects)' })
  linkedTasks(
    @Param('targetType', new ZodValidationPipe(targetTypeSchema)) targetType: TaskLinkTarget,
    @Param('targetId', new ZodValidationPipe(uuidSchema)) targetId: string,
    @CurrentUser() user: AuthUser,
  ): Promise<LinkedTaskDto[]> {
    return this.links.linkedTasks(targetType, targetId, user);
  }
}
