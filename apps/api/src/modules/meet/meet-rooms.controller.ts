import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  createRoomSchema,
  meetHostTargetSchema,
  type CreateRoomInput,
  type MeetHostTargetInput,
  type MeetRoomDto,
  type MeetTokenDto,
} from '@cuks/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/auth/auth-user';
import { MeetRoomsService } from './meet-rooms.service';

const uuidPipe = new ZodValidationPipe(z.string().uuid());

/** Call rooms + join tokens (docs/modules/14 §7, task 6.2). Class-level `meet.use` gate; per-room
 *  access (channel membership / link) is enforced in the service. */
@ApiTags('meet')
@RequirePermission('meet.use')
@Controller('meet/rooms')
export class MeetRoomsController {
  constructor(private readonly rooms: MeetRoomsService) {}

  @Post()
  @ApiOperation({ summary: 'Open (or reuse) a call room for a DM / channel / ad-hoc meeting' })
  create(
    @Body(new ZodValidationPipe(createRoomSchema)) body: CreateRoomInput,
    @CurrentUser() user: AuthUser,
  ): Promise<MeetRoomDto> {
    return this.rooms.openRoom(body, user);
  }

  @Get(':slug')
  @ApiOperation({ summary: 'A call room by its permanent slug' })
  get(@Param('slug') slug: string, @CurrentUser() user: AuthUser): Promise<MeetRoomDto> {
    return this.rooms.getBySlug(slug, user);
  }

  @Post(':id/token')
  @ApiOperation({ summary: 'Mint a LiveKit join token for this room' })
  token(@Param('id', uuidPipe) id: string, @CurrentUser() user: AuthUser): Promise<MeetTokenDto> {
    return this.rooms.mintToken(id, user);
  }

  // --- Host moderation (docs/modules/14 §3). The host check is enforced in the service. ---

  @Post(':id/host/mute')
  @ApiOperation({ summary: 'Host: mute a participant’s microphone' })
  mute(
    @Param('id', uuidPipe) id: string,
    @Body(new ZodValidationPipe(meetHostTargetSchema)) body: MeetHostTargetInput,
    @CurrentUser() user: AuthUser,
  ): Promise<void> {
    return this.rooms.hostMute(id, body.identity, user);
  }

  @Post(':id/host/mute-all')
  @ApiOperation({ summary: 'Host: mute everyone except yourself' })
  muteAll(@Param('id', uuidPipe) id: string, @CurrentUser() user: AuthUser): Promise<void> {
    return this.rooms.hostMuteAll(id, user);
  }

  @Post(':id/host/remove')
  @ApiOperation({ summary: 'Host: remove a participant from the call' })
  remove(
    @Param('id', uuidPipe) id: string,
    @Body(new ZodValidationPipe(meetHostTargetSchema)) body: MeetHostTargetInput,
    @CurrentUser() user: AuthUser,
  ): Promise<void> {
    return this.rooms.hostRemove(id, body.identity, user);
  }

  @Post(':id/host/end')
  @ApiOperation({ summary: 'Host: end the call for everyone' })
  end(@Param('id', uuidPipe) id: string, @CurrentUser() user: AuthUser): Promise<void> {
    return this.rooms.hostEnd(id, user);
  }
}
