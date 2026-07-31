import { Body, Controller, Get, HttpCode, Param, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  approveResolutionProposalSchema,
  createResolutionProposalSchema,
  rejectResolutionProposalSchema,
  updateResolutionProposalSchema,
  type AcquaintanceGateDto,
  type ApproveResolutionProposalInput,
  type CreateResolutionProposalInput,
  type RejectResolutionProposalInput,
  type ResolutionProposalDto,
  type UpdateResolutionProposalInput,
} from '@cuks/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/auth/auth-user';
import { ResolutionProposalsService } from './resolution-proposals.service';

const uuidSchema = z.string().uuid();

/**
 * Resolution proposals and the pre-execution reading gate (docs/modules/11 §12.11).
 * Drafting is `docflow.use` — the chancellery prepares the instruction — while the
 * decision is gated in the service on being the NAMED signer or their active deputy, which
 * no permission can substitute for.
 */
@ApiTags('docflow')
@Controller('docflow')
export class ResolutionProposalsController {
  constructor(private readonly proposals: ResolutionProposalsService) {}

  @Get('documents/:id/resolution-proposals')
  @RequirePermission('docflow.use')
  @ApiOperation({ summary: "A document's resolution proposals" })
  list(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<ResolutionProposalDto[]> {
    return this.proposals.list(id, user);
  }

  @Post('documents/:id/resolution-proposals')
  @RequirePermission('docflow.use')
  @ApiOperation({ summary: 'Draft a resolution for a signer to decide' })
  create(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(createResolutionProposalSchema))
    body: CreateResolutionProposalInput,
    @CurrentUser() user: AuthUser,
  ): Promise<ResolutionProposalDto> {
    return this.proposals.create(id, body, user);
  }

  @Patch('resolution-proposals/:id')
  @RequirePermission('docflow.use')
  @ApiOperation({ summary: 'Edit an undecided proposal (drafter only)' })
  update(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(updateResolutionProposalSchema))
    body: UpdateResolutionProposalInput,
    @CurrentUser() user: AuthUser,
  ): Promise<ResolutionProposalDto> {
    return this.proposals.update(id, body, user);
  }

  @Post('resolution-proposals/:id/actions/submit')
  @RequirePermission('docflow.use')
  @HttpCode(200)
  @ApiOperation({ summary: 'Hand the draft to its signer' })
  submit(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<ResolutionProposalDto> {
    return this.proposals.submit(id, user);
  }

  @Post('resolution-proposals/:id/actions/approve')
  @RequirePermission('docflow.use')
  @HttpCode(200)
  @ApiOperation({ summary: 'Approve: issue the resolution and shut the reading gate' })
  approve(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(approveResolutionProposalSchema))
    body: ApproveResolutionProposalInput,
    @CurrentUser() user: AuthUser,
  ): Promise<ResolutionProposalDto> {
    return this.proposals.approve(id, body, user);
  }

  @Post('resolution-proposals/:id/actions/reject')
  @RequirePermission('docflow.use')
  @HttpCode(200)
  @ApiOperation({ summary: 'Return the proposal to its drafter with a reason' })
  reject(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(rejectResolutionProposalSchema))
    body: RejectResolutionProposalInput,
    @CurrentUser() user: AuthUser,
  ): Promise<ResolutionProposalDto> {
    return this.proposals.reject(id, body, user);
  }

  @Post('acquaintance-batches/:id/actions/acknowledge')
  @RequirePermission('docflow.use')
  @HttpCode(200)
  @ApiOperation({ summary: 'Confirm reading; the last reader opens the gate immediately' })
  acknowledge(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<AcquaintanceGateDto> {
    return this.proposals.acknowledgeGate(id, user);
  }
}
