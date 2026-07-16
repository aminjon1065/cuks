import { Body, Controller, Delete, Get, HttpCode, Param, Post, Redirect } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { startRecordingSchema, type RecordingDto, type StartRecordingInput } from '@cuks/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/auth/auth-user';
import { RecordingsService } from './recordings.service';

const uuidPipe = new ZodValidationPipe(z.string().uuid());

/**
 * Recordings (docs/modules/14 §4/§7, task 6.6). Starting/stopping needs meet.record + being the room
 * host (checked in the service); viewing/download/delete are membership/manage-gated. `meet.use` is the
 * baseline; start/stop additionally require meet.record.
 */
@ApiTags('meet')
@RequirePermission('meet.use')
@Controller('meet')
export class RecordingsController {
  constructor(private readonly recordings: RecordingsService) {}

  @Post('rooms/:id/recording/start')
  @RequirePermission('meet.record')
  @ApiOperation({ summary: 'Host: start recording the room' })
  start(
    @Param('id', uuidPipe) id: string,
    @Body(new ZodValidationPipe(startRecordingSchema)) body: StartRecordingInput,
    @CurrentUser() user: AuthUser,
  ): Promise<RecordingDto> {
    return this.recordings.start(id, body, user);
  }

  @Post('rooms/:id/recording/stop')
  @RequirePermission('meet.record')
  @HttpCode(204)
  @ApiOperation({ summary: 'Host: stop the active recording' })
  stop(@Param('id', uuidPipe) id: string, @CurrentUser() user: AuthUser): Promise<void> {
    return this.recordings.stop(id, user);
  }

  @Get('recordings')
  @ApiOperation({ summary: 'My recordings (participant) / all (meet.recordings.manage)' })
  list(@CurrentUser() user: AuthUser): Promise<RecordingDto[]> {
    return this.recordings.list(user);
  }

  @Get('recordings/:id')
  @ApiOperation({ summary: 'A recording by id' })
  get(@Param('id', uuidPipe) id: string, @CurrentUser() user: AuthUser): Promise<RecordingDto> {
    return this.recordings.get(id, user);
  }

  @Get('recordings/:id/stream')
  @Redirect()
  @ApiOperation({ summary: 'Presigned inline URL for the player (302)' })
  async stream(
    @Param('id', uuidPipe) id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<{ url: string; statusCode: number }> {
    return { url: await this.recordings.streamUrl(id, user), statusCode: 302 };
  }

  @Get('recordings/:id/download')
  @Redirect()
  @ApiOperation({ summary: 'Presigned download URL — audited (302)' })
  async download(
    @Param('id', uuidPipe) id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<{ url: string; statusCode: number }> {
    return { url: await this.recordings.downloadUrl(id, user), statusCode: 302 };
  }

  @Delete('recordings/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a recording (host / meet.recordings.manage)' })
  remove(@Param('id', uuidPipe) id: string, @CurrentUser() user: AuthUser): Promise<void> {
    return this.recordings.remove(id, user);
  }
}
