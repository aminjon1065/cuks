import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  assignRoleSchema,
  createRoleSchema,
  permissionCatalog,
  updateRoleSchema,
  type AssignRoleInput,
  type CreateRoleInput,
  type PermissionCatalogEntry,
  type RoleAssignmentDto,
  type RoleDto,
  type UpdateRoleInput,
} from '@cuks/shared';
import type { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { RoleAssignmentsService } from './role-assignments.service';
import { RolesService } from './roles.service';

const uuidSchema = z.string().uuid();

@ApiTags('admin')
@RequirePermission('admin.roles.manage')
@Controller('admin')
export class AdminRbacController {
  constructor(
    private readonly roles: RolesService,
    private readonly assignments: RoleAssignmentsService,
  ) {}

  @Get('permissions')
  permissions(): PermissionCatalogEntry[] {
    return permissionCatalog();
  }

  @Get('roles')
  listRoles(): Promise<RoleDto[]> {
    return this.roles.list();
  }

  @Post('roles')
  createRole(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createRoleSchema)) body: CreateRoleInput,
  ): Promise<RoleDto> {
    return this.roles.create(body, user.id);
  }

  @Patch('roles/:id')
  updateRole(
    @CurrentUser() user: AuthUser,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(updateRoleSchema)) body: UpdateRoleInput,
  ): Promise<RoleDto> {
    return this.roles.update(id, body, user.id);
  }

  @Delete('roles/:id')
  @HttpCode(200)
  async deleteRole(
    @CurrentUser() user: AuthUser,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
  ): Promise<{ ok: true }> {
    await this.roles.remove(id, user.id);
    return { ok: true };
  }

  @Get('role-assignments')
  listAssignments(
    @Query('userId', new ZodValidationPipe(uuidSchema)) userId: string,
  ): Promise<RoleAssignmentDto[]> {
    return this.assignments.listByUser(userId);
  }

  @Post('role-assignments')
  assignRole(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(assignRoleSchema)) body: AssignRoleInput,
  ): Promise<RoleAssignmentDto> {
    return this.assignments.assign(body, user.id);
  }

  @Delete('role-assignments/:id')
  @HttpCode(200)
  async revokeAssignment(
    @CurrentUser() user: AuthUser,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
  ): Promise<{ ok: true }> {
    await this.assignments.revoke(id, user.id);
    return { ok: true };
  }
}
