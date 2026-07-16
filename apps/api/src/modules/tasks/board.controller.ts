import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  createColumnSchema,
  createLabelSchema,
  createTaskSchema,
  createTaskTemplateSchema,
  instantiateTemplateSchema,
  moveColumnSchema,
  updateColumnSchema,
  type BoardDto,
  type ColumnDto,
  type CreateColumnInput,
  type CreateLabelInput,
  type CreateTaskInput,
  type CreateTaskTemplateInput,
  type InstantiateTemplateInput,
  type LabelDto,
  type MoveColumnInput,
  type TaskCardDto,
  type TaskTemplateDto,
  type UpdateColumnInput,
} from '@cuks/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/auth/auth-user';
import { ColumnsService } from './columns.service';
import { ProjectsService } from './projects.service';
import { TasksService } from './tasks.service';
import { TaskTemplatesService } from './templates.service';

const uuidSchema = z.string().uuid();

/** Board data + column and card-creation for a project (docs/modules/15 §3/§8, task 4.2). */
@ApiTags('tasks')
@Controller('tasks/projects/:projectId')
export class BoardController {
  constructor(
    private readonly tasks: TasksService,
    private readonly columns: ColumnsService,
    private readonly projects: ProjectsService,
    private readonly templates: TaskTemplatesService,
  ) {}

  @Get('board')
  @RequirePermission('tasks.use')
  @ApiOperation({ summary: 'The whole board — columns, labels, members and cards' })
  board(
    @Param('projectId', new ZodValidationPipe(uuidSchema)) projectId: string,
    @CurrentUser() user: AuthUser,
  ): Promise<BoardDto> {
    return this.tasks.board(projectId, user);
  }

  @Post('cards')
  @RequirePermission('tasks.use')
  @ApiOperation({ summary: 'Create a card in a column (editor)' })
  createCard(
    @Param('projectId', new ZodValidationPipe(uuidSchema)) projectId: string,
    @Body(new ZodValidationPipe(createTaskSchema)) body: CreateTaskInput,
    @CurrentUser() user: AuthUser,
  ): Promise<TaskCardDto> {
    return this.tasks.createCard(projectId, body, user);
  }

  @Post('columns')
  @RequirePermission('tasks.use')
  @ApiOperation({ summary: 'Add a column (owner)' })
  createColumn(
    @Param('projectId', new ZodValidationPipe(uuidSchema)) projectId: string,
    @Body(new ZodValidationPipe(createColumnSchema)) body: CreateColumnInput,
    @CurrentUser() user: AuthUser,
  ): Promise<ColumnDto> {
    return this.columns.create(projectId, body, user);
  }

  @Patch('columns/:columnId')
  @RequirePermission('tasks.use')
  @ApiOperation({ summary: 'Edit a column — name / WIP / done flag (owner)' })
  updateColumn(
    @Param('projectId', new ZodValidationPipe(uuidSchema)) projectId: string,
    @Param('columnId', new ZodValidationPipe(uuidSchema)) columnId: string,
    @Body(new ZodValidationPipe(updateColumnSchema)) body: UpdateColumnInput,
    @CurrentUser() user: AuthUser,
  ): Promise<ColumnDto> {
    return this.columns.update(projectId, columnId, body, user);
  }

  @Post('columns/:columnId/move')
  @RequirePermission('tasks.use')
  @ApiOperation({ summary: 'Reorder a column (owner)' })
  moveColumn(
    @Param('projectId', new ZodValidationPipe(uuidSchema)) projectId: string,
    @Param('columnId', new ZodValidationPipe(uuidSchema)) columnId: string,
    @Body(new ZodValidationPipe(moveColumnSchema)) body: MoveColumnInput,
    @CurrentUser() user: AuthUser,
  ): Promise<ColumnDto> {
    return this.columns.move(projectId, columnId, body, user);
  }

  @Delete('columns/:columnId')
  @RequirePermission('tasks.use')
  @ApiOperation({ summary: 'Delete an empty column (owner)' })
  removeColumn(
    @Param('projectId', new ZodValidationPipe(uuidSchema)) projectId: string,
    @Param('columnId', new ZodValidationPipe(uuidSchema)) columnId: string,
    @CurrentUser() user: AuthUser,
  ): Promise<void> {
    return this.columns.remove(projectId, columnId, user);
  }

  @Get('labels')
  @RequirePermission('tasks.use')
  @ApiOperation({ summary: 'Project labels (viewer)' })
  listLabels(
    @Param('projectId', new ZodValidationPipe(uuidSchema)) projectId: string,
    @CurrentUser() user: AuthUser,
  ): Promise<LabelDto[]> {
    return this.projects.listLabels(projectId, user);
  }

  @Post('labels')
  @RequirePermission('tasks.use')
  @ApiOperation({ summary: 'Create a project label (editor)' })
  createLabel(
    @Param('projectId', new ZodValidationPipe(uuidSchema)) projectId: string,
    @Body(new ZodValidationPipe(createLabelSchema)) body: CreateLabelInput,
    @CurrentUser() user: AuthUser,
  ): Promise<LabelDto> {
    return this.projects.createLabel(projectId, body, user);
  }

  // --- Card templates (docs/modules/15 §4) ---

  @Get('templates')
  @RequirePermission('tasks.use')
  @ApiOperation({ summary: 'Project card templates (viewer)' })
  listTemplates(
    @Param('projectId', new ZodValidationPipe(uuidSchema)) projectId: string,
    @CurrentUser() user: AuthUser,
  ): Promise<TaskTemplateDto[]> {
    return this.templates.list(projectId, user);
  }

  @Post('templates')
  @RequirePermission('tasks.use')
  @ApiOperation({ summary: 'Create a card template (editor)' })
  createTemplate(
    @Param('projectId', new ZodValidationPipe(uuidSchema)) projectId: string,
    @Body(new ZodValidationPipe(createTaskTemplateSchema)) body: CreateTaskTemplateInput,
    @CurrentUser() user: AuthUser,
  ): Promise<TaskTemplateDto> {
    return this.templates.create(projectId, body, user);
  }

  @Delete('templates/:templateId')
  @RequirePermission('tasks.use')
  @ApiOperation({ summary: 'Delete a card template (editor)' })
  removeTemplate(
    @Param('projectId', new ZodValidationPipe(uuidSchema)) projectId: string,
    @Param('templateId', new ZodValidationPipe(uuidSchema)) templateId: string,
    @CurrentUser() user: AuthUser,
  ): Promise<void> {
    return this.templates.remove(projectId, templateId, user);
  }

  @Post('templates/:templateId/card')
  @RequirePermission('tasks.use')
  @ApiOperation({ summary: 'Create a card from a template (editor)' })
  instantiateTemplate(
    @Param('projectId', new ZodValidationPipe(uuidSchema)) projectId: string,
    @Param('templateId', new ZodValidationPipe(uuidSchema)) templateId: string,
    @Body(new ZodValidationPipe(instantiateTemplateSchema)) body: InstantiateTemplateInput,
    @CurrentUser() user: AuthUser,
  ): Promise<TaskCardDto> {
    return this.templates.instantiate(projectId, templateId, body, user);
  }
}
