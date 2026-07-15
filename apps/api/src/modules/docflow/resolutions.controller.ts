import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  createResolutionSchema,
  extendResolutionSchema,
  removeResolutionControlSchema,
  reportResolutionSchema,
  type CreateResolutionInput,
  type ExtendResolutionInput,
  type RemoveResolutionControlInput,
  type ReportResolutionInput,
  type ResolutionDto,
} from '@cuks/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/auth/auth-user';
import { ResolutionsService } from './resolutions.service';

const uuidSchema = z.string().uuid();

/**
 * Resolutions (docs/modules/11 §3/§5, task 3.4): a leader issues an instruction
 * (`docflow.resolve`); the executor reports/completes it and the author or a control
 * officer extends/cancels it (all `docflow.use`, enforced per-role in the service).
 */
@ApiTags('docflow')
@Controller('docflow')
export class ResolutionsController {
  constructor(private readonly resolutions: ResolutionsService) {}

  @Get('documents/:id/resolutions')
  @RequirePermission('docflow.use')
  @ApiOperation({ summary: 'The resolution tree of a document' })
  forDocument(
    @CurrentUser() user: AuthUser,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
  ): Promise<ResolutionDto[]> {
    return this.resolutions.forDocument(id, user);
  }

  @Post('documents/:id/resolutions')
  @RequirePermission('docflow.resolve')
  @ApiOperation({ summary: 'Issue a resolution on a document' })
  create(
    @CurrentUser() user: AuthUser,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(createResolutionSchema)) body: CreateResolutionInput,
  ): Promise<ResolutionDto[]> {
    return this.resolutions.create(id, body, user);
  }

  @Post('resolutions/:id/subresolutions')
  @RequirePermission('docflow.use')
  @ApiOperation({ summary: 'Delegate a sub-resolution (executor only)' })
  createSub(
    @CurrentUser() user: AuthUser,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(createResolutionSchema)) body: CreateResolutionInput,
  ): Promise<ResolutionDto[]> {
    return this.resolutions.createSub(id, body, user);
  }

  @Post('resolutions/:id/actions/report')
  @RequirePermission('docflow.use')
  @ApiOperation({ summary: 'Submit the execution report (executor)' })
  report(
    @CurrentUser() user: AuthUser,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(reportResolutionSchema)) body: ReportResolutionInput,
  ): Promise<ResolutionDto[]> {
    return this.resolutions.report(id, body, user);
  }

  @Post('resolutions/:id/actions/done')
  @RequirePermission('docflow.use')
  @ApiOperation({ summary: 'Mark the resolution executed' })
  complete(
    @CurrentUser() user: AuthUser,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
  ): Promise<ResolutionDto[]> {
    return this.resolutions.complete(id, user);
  }

  @Post('resolutions/:id/actions/extend')
  @RequirePermission('docflow.use')
  @ApiOperation({ summary: 'Extend the deadline (author or control officer)' })
  extend(
    @CurrentUser() user: AuthUser,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(extendResolutionSchema)) body: ExtendResolutionInput,
  ): Promise<ResolutionDto[]> {
    return this.resolutions.extend(id, body, user);
  }

  @Post('resolutions/:id/actions/cancel')
  @RequirePermission('docflow.use')
  @ApiOperation({ summary: 'Cancel the resolution (author or control officer)' })
  cancel(
    @CurrentUser() user: AuthUser,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
  ): Promise<ResolutionDto[]> {
    return this.resolutions.cancel(id, user);
  }

  @Post('resolutions/:id/actions/uncontrol')
  @RequirePermission('docflow.use')
  @ApiOperation({ summary: 'Remove the resolution from control, keeping it active (with reason)' })
  removeFromControl(
    @CurrentUser() user: AuthUser,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(removeResolutionControlSchema)) body: RemoveResolutionControlInput,
  ): Promise<ResolutionDto[]> {
    return this.resolutions.removeFromControl(id, body, user);
  }
}
