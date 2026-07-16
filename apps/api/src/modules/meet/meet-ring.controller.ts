import { Body, Controller, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { startRingSchema, type StartRingInput } from '@cuks/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/auth/auth-user';
import { RingService } from './ring.service';

const uuidPipe = new ZodValidationPipe(z.string().uuid());

/** 1:1 call ring-flow (docs/modules/14 §2/§7). `meet.use` gates the routes; party checks are in the
 *  service. */
@ApiTags('meet')
@RequirePermission('meet.use')
@Controller('meet/ring')
export class MeetRingController {
  constructor(private readonly ring: RingService) {}

  @Post()
  @ApiOperation({ summary: 'Ring the other member of a DM for a 1:1 call' })
  start(
    @Body(new ZodValidationPipe(startRingSchema)) body: StartRingInput,
    @CurrentUser() user: AuthUser,
  ): Promise<void> {
    return this.ring.start(user, body);
  }

  @Post(':roomId/accept')
  @ApiOperation({ summary: 'Accept an incoming ring' })
  accept(@Param('roomId', uuidPipe) roomId: string, @CurrentUser() user: AuthUser): Promise<void> {
    return this.ring.accept(user, roomId);
  }

  @Post(':roomId/decline')
  @ApiOperation({ summary: 'Decline an incoming ring' })
  decline(@Param('roomId', uuidPipe) roomId: string, @CurrentUser() user: AuthUser): Promise<void> {
    return this.ring.decline(user, roomId);
  }

  @Post(':roomId/cancel')
  @ApiOperation({ summary: 'Cancel a ring you started before it is answered' })
  cancel(@Param('roomId', uuidPipe) roomId: string, @CurrentUser() user: AuthUser): Promise<void> {
    return this.ring.cancel(user, roomId);
  }
}
