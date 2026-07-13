import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  createUserSchema,
  listUsersQuerySchema,
  updateUserSchema,
  type CreateUserInput,
  type ListUsersQuery,
  type PaginatedResult,
  type TempPasswordDto,
  type UpdateUserInput,
  type UserDetailDto,
  type UserListItemDto,
} from '@cuks/shared';
import type { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AdminUsersService } from './admin-users.service';

const idParam = z.string().uuid();

@ApiTags('admin')
@RequirePermission('admin.users.manage')
@Controller('admin/users')
export class AdminUsersController {
  constructor(private readonly users: AdminUsersService) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(listUsersQuerySchema)) query: ListUsersQuery,
  ): Promise<PaginatedResult<UserListItemDto>> {
    return this.users.list(query);
  }

  @Get(':id')
  detail(@Param('id', new ZodValidationPipe(idParam)) id: string): Promise<UserDetailDto> {
    return this.users.getDetail(id);
  }

  @Post()
  create(
    @CurrentUser() actor: AuthUser,
    @Body(new ZodValidationPipe(createUserSchema)) body: CreateUserInput,
  ): Promise<TempPasswordDto> {
    return this.users.create(body, actor);
  }

  @Patch(':id')
  @HttpCode(200)
  async update(
    @CurrentUser() actor: AuthUser,
    @Param('id', new ZodValidationPipe(idParam)) id: string,
    @Body(new ZodValidationPipe(updateUserSchema)) body: UpdateUserInput,
  ): Promise<{ ok: true }> {
    await this.users.update(id, body, actor);
    return { ok: true };
  }

  @Post(':id/block')
  @HttpCode(200)
  async block(
    @CurrentUser() actor: AuthUser,
    @Param('id', new ZodValidationPipe(idParam)) id: string,
  ): Promise<{ ok: true }> {
    await this.users.block(id, actor);
    return { ok: true };
  }

  @Post(':id/unblock')
  @HttpCode(200)
  async unblock(
    @CurrentUser() actor: AuthUser,
    @Param('id', new ZodValidationPipe(idParam)) id: string,
  ): Promise<{ ok: true }> {
    await this.users.unblock(id, actor);
    return { ok: true };
  }

  @Post(':id/reset-password')
  @HttpCode(200)
  resetPassword(
    @CurrentUser() actor: AuthUser,
    @Param('id', new ZodValidationPipe(idParam)) id: string,
  ): Promise<TempPasswordDto> {
    return this.users.resetPassword(id, actor);
  }

  @Post(':id/reset-totp')
  @HttpCode(200)
  async resetTotp(
    @CurrentUser() actor: AuthUser,
    @Param('id', new ZodValidationPipe(idParam)) id: string,
  ): Promise<{ ok: true }> {
    await this.users.resetTotp(id, actor);
    return { ok: true };
  }

  @Delete(':id')
  @HttpCode(200)
  async remove(
    @CurrentUser() actor: AuthUser,
    @Param('id', new ZodValidationPipe(idParam)) id: string,
  ): Promise<{ ok: true }> {
    await this.users.remove(id, actor);
    return { ok: true };
  }
}
