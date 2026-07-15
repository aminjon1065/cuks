import { Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { AcknowledgementSheetDto } from '@cuks/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/auth/auth-user';
import { AcknowledgementsService } from './acknowledgements.service';

const uuidSchema = z.string().uuid();

/**
 * Acknowledgements / ознакомление (docs/modules/11 §6, task 3.6): an employee reads the
 * acknowledgement sheet and marks the order read. Both need only `docflow.use` — the
 * per-user sheet membership is enforced in the service.
 */
@ApiTags('docflow')
@Controller('docflow')
export class AcknowledgementsController {
  constructor(private readonly acknowledgements: AcknowledgementsService) {}

  @Get('documents/:id/acquaintances')
  @RequirePermission('docflow.use')
  @ApiOperation({ summary: "A document's acknowledgement sheet" })
  sheet(
    @CurrentUser() user: AuthUser,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
  ): Promise<AcknowledgementSheetDto> {
    return this.acknowledgements.sheetForDocument(id, user);
  }

  @Post('route-steps/:id/actions/acknowledge')
  @RequirePermission('docflow.use')
  @ApiOperation({ summary: 'Acknowledge (read) the document at an acknowledge step' })
  acknowledge(
    @CurrentUser() user: AuthUser,
    @Param('id', new ZodValidationPipe(uuidSchema)) id: string,
  ): Promise<AcknowledgementSheetDto> {
    return this.acknowledgements.acknowledge(id, user);
  }
}
