import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  createProjectSchema,
  setProjectMemberSchema,
  updateProjectSchema,
  type CreateProjectInput,
  type ProjectDto,
  type ProjectMemberDto,
  type SetProjectMemberInput,
  type UpdateProjectInput,
} from '@cuks/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/auth/auth-user';
import { ProjectsService } from './projects.service';

const uuidSchema = z.string().uuid();

/** Task projects (docs/modules/15 §1/§2, task 4.2). Reading is `tasks.use` with per-project ACL;
 *  creating a project needs `tasks.projects.create`. */
@ApiTags('tasks')
@Controller('tasks/projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  @RequirePermission('tasks.use')
  @ApiOperation({ summary: 'Projects I am a member of' })
  list(@CurrentUser() user: AuthUser): Promise<ProjectDto[]> {
    return this.projects.list(user);
  }

  @Post()
  @RequirePermission('tasks.projects.create')
  @ApiOperation({ summary: 'Create a project (with default columns; caller becomes owner)' })
  create(
    @Body(new ZodValidationPipe(createProjectSchema)) body: CreateProjectInput,
    @CurrentUser() user: AuthUser,
  ): Promise<ProjectDto> {
    return this.projects.create(body, user);
  }

  // Literal path before the :id param.
  @Get('by-key/:key')
  @RequirePermission('tasks.use')
  @ApiOperation({ summary: 'Resolve a project by its key (for the board URL)' })
  byKey(@Param('key') key: string, @CurrentUser() user: AuthUser): Promise<ProjectDto> {
    return this.projects.getByKey(key, user);
  }

  @Get(':id')
  @RequirePermission('tasks.use')
  @ApiOperation({ summary: 'Get a project' })
  get(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<ProjectDto> {
    return this.projects.getById(id, user);
  }

  @Patch(':id')
  @RequirePermission('tasks.use')
  @ApiOperation({ summary: 'Edit a project (owner)' })
  update(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(updateProjectSchema)) body: UpdateProjectInput,
    @CurrentUser() user: AuthUser,
  ): Promise<ProjectDto> {
    return this.projects.update(id, body, user);
  }

  @Post(':id/archive')
  @RequirePermission('tasks.use')
  @ApiOperation({ summary: 'Archive a project (owner)' })
  archive(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<ProjectDto> {
    return this.projects.archive(id, user);
  }

  @Get(':id/members')
  @RequirePermission('tasks.use')
  @ApiOperation({ summary: 'Project members and their roles' })
  members(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<ProjectMemberDto[]> {
    return this.projects.members(id, user);
  }

  @Post(':id/members')
  @RequirePermission('tasks.use')
  @ApiOperation({ summary: 'Add or change a member role (owner)' })
  setMember(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(setProjectMemberSchema)) body: SetProjectMemberInput,
    @CurrentUser() user: AuthUser,
  ): Promise<ProjectMemberDto[]> {
    return this.projects.setMember(id, body, user);
  }

  @Delete(':id/members/:userId')
  @RequirePermission('tasks.use')
  @ApiOperation({ summary: 'Remove a member (owner)' })
  removeMember(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Param('userId', new ZodValidationPipe(uuidSchema)) userId: string,
    @CurrentUser() user: AuthUser,
  ): Promise<ProjectMemberDto[]> {
    return this.projects.removeMember(id, userId, user);
  }
}
