import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  cancelDispatchSchema,
  confirmDispatchSchema,
  createDispatchSchema,
  failDispatchSchema,
  type CancelDispatchInput,
  type ConfirmDispatchInput,
  type CreateDispatchInput,
  type DocumentDispatchDto,
  type FailDispatchInput,
} from '@cuks/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/auth/auth-user';
import { DispatchesService } from './dispatches.service';

const uuidSchema = z.string().uuid();

/**
 * Recording how a registered outgoing document was sent (docs/modules/11 §12.1, plan §7.7).
 * Reading the attempt log is `docflow.use` — every participant may see whether the answer
 * went out — while recording one is the chancellery's own act (`docflow.register`), checked
 * again in the service against the specific document.
 */
@ApiTags('docflow')
@Controller('docflow')
export class DispatchesController {
  constructor(private readonly dispatches: DispatchesService) {}

  @Get('documents/:id/dispatches')
  @RequirePermission('docflow.use')
  @ApiOperation({ summary: "A document's send attempts, newest first" })
  @ApiOkResponse({ description: 'The attempt log: channel, addressee, outcome and receipt' })
  list(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<DocumentDispatchDto[]> {
    return this.dispatches.list(id, user);
  }

  @Post('documents/:id/dispatches')
  @RequirePermission('docflow.register')
  @ApiOperation({ summary: 'Open a send attempt for a registered outgoing document' })
  @ApiCreatedResponse({ description: 'The attempt, in its initial state' })
  create(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(createDispatchSchema)) body: CreateDispatchInput,
    @CurrentUser() user: AuthUser,
  ): Promise<DocumentDispatchDto> {
    return this.dispatches.create(id, body, user);
  }

  @Post('dispatches/:id/actions/confirm')
  @RequirePermission('docflow.register')
  @HttpCode(200)
  @ApiOperation({ summary: 'Confirm the send happened, optionally attaching the receipt' })
  @ApiOkResponse({ description: 'The attempt, now confirmed' })
  confirm(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(confirmDispatchSchema)) body: ConfirmDispatchInput,
    @CurrentUser() user: AuthUser,
  ): Promise<DocumentDispatchDto> {
    return this.dispatches.confirm(id, body, user);
  }

  @Post('dispatches/:id/actions/fail')
  @RequirePermission('docflow.register')
  @HttpCode(200)
  @ApiOperation({ summary: 'Record that the attempt did not reach the addressee' })
  @ApiOkResponse({ description: 'The attempt, now failed, with the reason on it' })
  fail(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(failDispatchSchema)) body: FailDispatchInput,
    @CurrentUser() user: AuthUser,
  ): Promise<DocumentDispatchDto> {
    return this.dispatches.fail(id, body, user);
  }

  @Post('dispatches/:id/actions/cancel')
  @RequirePermission('docflow.register')
  @HttpCode(200)
  @ApiOperation({ summary: 'Withdraw an attempt that was never made' })
  @ApiOkResponse({ description: 'The attempt, now cancelled' })
  cancel(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @Body(new ZodValidationPipe(cancelDispatchSchema)) body: CancelDispatchInput,
    @CurrentUser() user: AuthUser,
  ): Promise<DocumentDispatchDto> {
    return this.dispatches.cancel(id, body, user);
  }

  @Post('dispatches/:id/actions/retry')
  @RequirePermission('docflow.register')
  @HttpCode(200)
  @ApiOperation({ summary: 'Open a fresh attempt for the same addressee' })
  @ApiOkResponse({ description: 'The new attempt — the failed one stays in the log' })
  retry(
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<DocumentDispatchDto> {
    return this.dispatches.retry(id, user);
  }
}
