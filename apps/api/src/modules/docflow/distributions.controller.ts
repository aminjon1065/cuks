import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  createDistributionSchema,
  type CreateDistributionInput,
  type DistributionDto,
} from '@cuks/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/auth/auth-user';
import { DistributionsService } from './distributions.service';

const uuidSchema = z.string().uuid();

/**
 * Distributing an internal document for acknowledgement (docs/modules/11 §12.4, plan §7).
 *
 * `docflow.use` for both: sending an order round is the author's own act, not a chancellery
 * privilege, and the service checks the specific document (author or chancellery) on top of
 * the permission. Acknowledging happens through the existing
 * `POST /docflow/acquaintance-batches/:id/actions/acknowledge` — a distribution batch is the
 * same object as the pre-execution gate, so it needs no second endpoint.
 */
@ApiTags('docflow')
@Controller('docflow')
export class DistributionsController {
  constructor(private readonly distributions: DistributionsService) {}

  @Get('documents/:id/distributions')
  @RequirePermission('docflow.use')
  @ApiOperation({ summary: "A document's distribution sheets, newest first" })
  list(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<DistributionDto[]> {
    return this.distributions.list(id, user);
  }

  @Post('documents/:id/distributions')
  @RequirePermission('docflow.use')
  @ApiOperation({ summary: 'Send a registered internal document round for acknowledgement' })
  create(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(createDistributionSchema)) body: CreateDistributionInput,
    @CurrentUser() user: AuthUser,
  ): Promise<DistributionDto> {
    return this.distributions.create(id, body, user);
  }
}
