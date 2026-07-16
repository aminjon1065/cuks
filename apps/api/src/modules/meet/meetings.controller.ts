import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  createMeetingSchema,
  meetingsRangeSchema,
  updateMeetingSchema,
  type CreateMeetingInput,
  type MeetingDto,
  type MeetingsRange,
  type UpdateMeetingInput,
} from '@cuks/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/auth/auth-user';
import { MeetingsService } from './meetings.service';

const uuidPipe = new ZodValidationPipe(z.string().uuid());
const rangePipe = new ZodValidationPipe(meetingsRangeSchema);

/** Scheduled meetings (docs/modules/14 §7, task 6.5). `meet.use` gates the routes; organizer-only
 *  edit/cancel is enforced in the service. */
@ApiTags('meet')
@RequirePermission('meet.use')
@Controller('meet/meetings')
export class MeetingsController {
  constructor(private readonly meetings: MeetingsService) {}

  @Get()
  @ApiOperation({ summary: 'My meetings for a range (today / upcoming / past)' })
  list(
    @Query('range', rangePipe) range: MeetingsRange,
    @CurrentUser() user: AuthUser,
  ): Promise<MeetingDto[]> {
    return this.meetings.list(range, user);
  }

  @Post()
  @ApiOperation({ summary: 'Schedule a meeting' })
  create(
    @Body(new ZodValidationPipe(createMeetingSchema)) body: CreateMeetingInput,
    @CurrentUser() user: AuthUser,
  ): Promise<MeetingDto> {
    return this.meetings.create(body, user);
  }

  @Get(':id')
  @ApiOperation({ summary: 'A meeting by id (invitee / organizer)' })
  get(@Param('id', uuidPipe) id: string, @CurrentUser() user: AuthUser): Promise<MeetingDto> {
    return this.meetings.get(id, user);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Edit or cancel a meeting (organizer)' })
  patch(
    @Param('id', uuidPipe) id: string,
    @Body(new ZodValidationPipe(updateMeetingSchema)) body: UpdateMeetingInput,
    @CurrentUser() user: AuthUser,
  ): Promise<MeetingDto> {
    return this.meetings.patch(id, body, user);
  }
}
