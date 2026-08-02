import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { z } from 'zod';
import {
  approveResolutionProposalSchema,
  createResolutionProposalSchema,
  createResolutionTypeSchema,
  rejectResolutionProposalSchema,
  updateResolutionProposalSchema,
  updateResolutionTypeSchema,
  type AcquaintanceGateDto,
  type ApproveResolutionProposalInput,
  type CreateResolutionProposalInput,
  type CreateResolutionTypeInput,
  type RejectResolutionProposalInput,
  type ResolutionProposalDto,
  type ResolutionTypeDto,
  type UpdateResolutionProposalInput,
  type UpdateResolutionTypeInput,
} from '@cuks/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/auth/auth-user';
import { ResolutionProposalsService } from './resolution-proposals.service';
import { ResolutionTypesService } from './resolution-types.service';

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
  constructor(
    private readonly proposals: ResolutionProposalsService,
    private readonly types: ResolutionTypesService,
  ) {}

  // --- Resolution-type dictionary -------------------------------------------

  @Get('resolution-types')
  @RequirePermission('docflow.use')
  @ApiOperation({
    summary: 'Resolution types (optional `?active=true` for the proposal picker)',
  })
  @ApiOkResponse({ description: 'Every type, or only the active ones when `?active=true`' })
  listTypes(@Query('active') active?: string): Promise<ResolutionTypeDto[]> {
    return this.types.list(active === 'true');
  }

  @Post('resolution-types')
  @RequirePermission('docflow.journals.manage')
  @ApiOperation({ summary: 'Add a resolution type' })
  @ApiCreatedResponse({ description: 'The new resolution type' })
  createType(
    @Body(new ZodValidationPipe(createResolutionTypeSchema)) body: CreateResolutionTypeInput,
    @CurrentUser() user: AuthUser,
  ): Promise<ResolutionTypeDto> {
    return this.types.create(body, user);
  }

  @Patch('resolution-types/:id')
  @RequirePermission('docflow.journals.manage')
  @ApiOperation({ summary: 'Edit a resolution type' })
  @ApiOkResponse({ description: 'The updated resolution type' })
  updateType(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(updateResolutionTypeSchema)) body: UpdateResolutionTypeInput,
    @CurrentUser() user: AuthUser,
  ): Promise<ResolutionTypeDto> {
    return this.types.update(id, body, user);
  }

  @Delete('resolution-types/:id')
  @RequirePermission('docflow.journals.manage')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete an unused resolution type' })
  @ApiNoContentResponse({
    description: 'Deleted — 204 with no body; a type any proposal still uses is refused with 409',
  })
  async removeType(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<void> {
    await this.types.remove(id, user);
  }

  // --- Proposals -------------------------------------------------------------

  @Get('documents/:id/resolution-proposals')
  @RequirePermission('docflow.use')
  @ApiOperation({ summary: "A document's resolution proposals" })
  @ApiOkResponse({ description: 'Proposals with their status, signer and decision' })
  list(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<ResolutionProposalDto[]> {
    return this.proposals.list(id, user);
  }

  @Post('documents/:id/resolution-proposals')
  @RequirePermission('docflow.use')
  @ApiOperation({ summary: 'Draft a resolution for a signer to decide' })
  @ApiCreatedResponse({ description: 'The drafted proposal' })
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
  @ApiOkResponse({ description: 'The updated proposal' })
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
  @ApiOkResponse({ description: 'The proposal, now waiting on its signer' })
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
  @ApiOkResponse({
    description: 'The approved proposal with the id of the resolution it issued, and its gate',
  })
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
  @ApiOkResponse({ description: 'The rejected proposal, with the reason on it' })
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
  @ApiOkResponse({
    description: 'The gate with the caller’s line marked read, and its release moment if it opened',
  })
  acknowledge(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<AcquaintanceGateDto> {
    return this.proposals.acknowledgeGate(id, user);
  }
}
