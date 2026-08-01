import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  inboundExchangeQuerySchema,
  registerInboundExchangeSchema,
  rejectInboundExchangeSchema,
  type InboundExchangeDto,
  type InboundExchangeQuery,
  type PaginatedResult,
  type RegisterInboundExchangeInput,
  type RejectInboundExchangeInput,
} from '@cuks/shared';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';
import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../../common/auth/auth-user';
import { InboundReviewService } from './inbound-review.service';

const uuidSchema = z.string().uuid();

/**
 * The exchange review queue (plan этап 10). Guarded by `docflow.register`: everything here
 * ends in a registration number or in a refusal recorded against the register, and both are
 * chancellery acts.
 */
@ApiTags('docflow')
@Controller('docflow/exchange/inbound')
export class InboundReviewController {
  constructor(private readonly review: InboundReviewService) {}

  @Get()
  @RequirePermission('docflow.register')
  @ApiOperation({ summary: 'Messages that arrived and are waiting to be turned into documents' })
  list(
    @Query(new ZodValidationPipe(inboundExchangeQuerySchema)) query: InboundExchangeQuery,
    @CurrentUser() user: AuthUser,
  ): Promise<PaginatedResult<InboundExchangeDto>> {
    return this.review.list(query, user);
  }

  @Post(':id/actions/register')
  @RequirePermission('docflow.register')
  @HttpCode(200)
  @ApiOperation({ summary: 'Register the message as an incoming document' })
  register(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(registerInboundExchangeSchema))
    body: RegisterInboundExchangeInput,
    @CurrentUser() user: AuthUser,
  ): Promise<InboundExchangeDto> {
    return this.review.register(id, body, user);
  }

  @Post(':id/actions/reject')
  @RequirePermission('docflow.register')
  @HttpCode(200)
  @ApiOperation({ summary: 'Refuse the message, with a reason' })
  reject(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(rejectInboundExchangeSchema)) body: RejectInboundExchangeInput,
    @CurrentUser() user: AuthUser,
  ): Promise<InboundExchangeDto> {
    return this.review.reject(id, body, user);
  }
}
