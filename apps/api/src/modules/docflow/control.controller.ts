import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { ControlItemDto } from '@cuks/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import type { AuthUser } from '../../common/auth/auth-user';
import { ControlService } from './control.service';

/** Execution control (docs/modules/11 §5, task 3.8). The «На контроле» view is gated by
 *  `docflow.control`; ДСП documents the caller cannot see are hidden per-row. */
@ApiTags('docflow')
@Controller('docflow')
export class ControlController {
  constructor(private readonly control: ControlService) {}

  @Get('control')
  @RequirePermission('docflow.control')
  @ApiOperation({ summary: 'Everything on control — resolutions and documents with deadlines' })
  list(@CurrentUser() user: AuthUser): Promise<ControlItemDto[]> {
    return this.control.list(user);
  }
}
