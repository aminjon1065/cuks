import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  createSubstitutionSchema,
  type CreateSubstitutionInput,
  type SubstitutionDto,
} from '@cuks/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/auth/auth-user';
import { SubstitutionsService } from './substitutions.service';

const uuidSchema = z.string().uuid();
const optionalUuid = z.string().uuid().optional();

/** Substitutions / deputies (docs/05-auth-rbac.md §6, task 3.11). A principal (leader) manages
 *  their own delegations; an admin (`admin.substitutions.manage`) manages anyone's. Base gate is
 *  `docflow.use`; the per-row rule (self vs admin) is enforced in the service. */
@ApiTags('docflow')
@Controller('docflow/substitutions')
export class SubstitutionsController {
  constructor(private readonly substitutions: SubstitutionsService) {}

  @Get()
  @RequirePermission('docflow.use')
  @ApiOperation({ summary: 'Substitutions I am party to (or a principal’s, for an admin)' })
  list(
    @Query('principalId', new ZodValidationPipe(optionalUuid)) principalId: string | undefined,
    @CurrentUser() user: AuthUser,
  ): Promise<SubstitutionDto[]> {
    return this.substitutions.list(user, principalId);
  }

  @Post()
  @RequirePermission('docflow.use')
  @ApiOperation({
    summary: 'Delegate route duties to a deputy (own duties, or anyone’s for admin)',
  })
  create(
    @Body(new ZodValidationPipe(createSubstitutionSchema)) body: CreateSubstitutionInput,
    @CurrentUser() user: AuthUser,
  ): Promise<SubstitutionDto> {
    return this.substitutions.create(body, user);
  }

  @Delete(':id')
  @RequirePermission('docflow.use')
  @ApiOperation({ summary: 'Revoke a substitution (its principal, or an admin)' })
  remove(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<void> {
    return this.substitutions.remove(id, user);
  }
}
