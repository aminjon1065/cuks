import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  assignPositionSchema,
  createOrgUnitSchema,
  createPositionSchema,
  moveOrgUnitSchema,
  updateOrgUnitSchema,
  updatePositionSchema,
  type AssignPositionInput,
  type CreateOrgUnitInput,
  type CreatePositionInput,
  type MoveOrgUnitInput,
  type OrgUnitDto,
  type OrgUnitTreeNode,
  type PositionDto,
  type UpdateOrgUnitInput,
  type UpdatePositionInput,
  type UserPositionDto,
} from '@cuks/shared';
import type { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { OrgUnitsService } from './org-units.service';
import { PositionsService } from './positions.service';
import { UserPositionsService } from './user-positions.service';

const uuidSchema = z.string().uuid();

@ApiTags('admin')
@RequirePermission('admin.org.manage')
@Controller('admin')
export class OrgController {
  constructor(
    private readonly units: OrgUnitsService,
    private readonly positions: PositionsService,
    private readonly userPositions: UserPositionsService,
  ) {}

  // --- Org units ---

  @Get('org-units')
  tree(): Promise<OrgUnitTreeNode[]> {
    return this.units.tree();
  }

  @Post('org-units')
  createUnit(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createOrgUnitSchema)) body: CreateOrgUnitInput,
  ): Promise<OrgUnitDto> {
    return this.units.create(body, user.id);
  }

  @Patch('org-units/:id')
  updateUnit(
    @CurrentUser() user: AuthUser,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(updateOrgUnitSchema)) body: UpdateOrgUnitInput,
  ): Promise<OrgUnitDto> {
    return this.units.update(id, body, user.id);
  }

  @Post('org-units/:id/move')
  @HttpCode(200)
  moveUnit(
    @CurrentUser() user: AuthUser,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(moveOrgUnitSchema)) body: MoveOrgUnitInput,
  ): Promise<OrgUnitDto> {
    return this.units.move(id, body.parentId, user.id);
  }

  @Delete('org-units/:id')
  @HttpCode(200)
  async deleteUnit(
    @CurrentUser() user: AuthUser,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
  ): Promise<{ ok: true }> {
    await this.units.remove(id, user.id);
    return { ok: true };
  }

  // --- Positions ---

  @Get('positions')
  listPositions(
    @Query('orgUnitId', new ZodValidationPipe(uuidSchema)) orgUnitId: string,
  ): Promise<PositionDto[]> {
    return this.positions.listByUnit(orgUnitId);
  }

  @Post('positions')
  createPosition(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createPositionSchema)) body: CreatePositionInput,
  ): Promise<PositionDto> {
    return this.positions.create(body, user.id);
  }

  @Patch('positions/:id')
  updatePosition(
    @CurrentUser() user: AuthUser,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(updatePositionSchema)) body: UpdatePositionInput,
  ): Promise<PositionDto> {
    return this.positions.update(id, body, user.id);
  }

  @Delete('positions/:id')
  @HttpCode(200)
  async deletePosition(
    @CurrentUser() user: AuthUser,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
  ): Promise<{ ok: true }> {
    await this.positions.remove(id, user.id);
    return { ok: true };
  }

  // --- User positions ---

  @Get('user-positions')
  listUserPositions(
    @Query('userId', new ZodValidationPipe(uuidSchema)) userId: string,
  ): Promise<UserPositionDto[]> {
    return this.userPositions.listByUser(userId);
  }

  @Post('user-positions')
  assignPosition(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(assignPositionSchema)) body: AssignPositionInput,
  ): Promise<UserPositionDto> {
    return this.userPositions.assign(body, user.id);
  }

  @Post('user-positions/:id/primary')
  @HttpCode(200)
  setPrimary(
    @CurrentUser() user: AuthUser,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
  ): Promise<UserPositionDto> {
    return this.userPositions.setPrimary(id, user.id);
  }

  @Delete('user-positions/:id')
  @HttpCode(200)
  async unassignPosition(
    @CurrentUser() user: AuthUser,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
  ): Promise<{ ok: true }> {
    await this.userPositions.unassign(id, user.id);
    return { ok: true };
  }
}
