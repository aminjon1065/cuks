import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  addChannelMemberSchema,
  channelFromIncidentSchema,
  createChannelSchema,
  createDmSchema,
  markReadSchema,
  updateChannelSchema,
  updateMembershipSchema,
  type AddChannelMemberInput,
  type ChannelDto,
  type ChannelFromIncidentInput,
  type ChannelListItemDto,
  type ChatUnreadTotalsDto,
  type CreateChannelInput,
  type CreateDmInput,
  type MarkReadInput,
  type UpdateChannelInput,
  type UpdateMembershipInput,
} from '@cuks/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthUser } from '../../common/auth/auth-user';
import { ChannelsService } from './channels.service';
import { IncidentChannelsService } from './incident-channels.service';

const uuidPipe = new ZodValidationPipe(z.string().uuid());

/** Channels, DMs and membership (docs/modules/13 §8, tasks 5.2/5.6). */
@ApiTags('chat')
@RequirePermission('chat.use')
@Controller('chat/channels')
export class ChannelsController {
  constructor(
    private readonly channels: ChannelsService,
    private readonly incidentChannels: IncidentChannelsService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'My conversations (pinned first, then recent)' })
  list(@CurrentUser() user: AuthUser): Promise<ChannelListItemDto[]> {
    return this.channels.myChannels(user);
  }

  @Get('catalog')
  @ApiOperation({ summary: 'Joinable public channels' })
  catalog(@CurrentUser() user: AuthUser): Promise<ChannelListItemDto[]> {
    return this.channels.catalog(user);
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Sidebar totals: unread + mentions across my conversations' })
  unreadCount(@CurrentUser() user: AuthUser): Promise<ChatUnreadTotalsDto> {
    return this.channels.unreadTotals(user);
  }

  @Post()
  @RequirePermission('chat.channels.create')
  @ApiOperation({ summary: 'Create a public / private channel' })
  create(
    @Body(new ZodValidationPipe(createChannelSchema)) body: CreateChannelInput,
    @CurrentUser() user: AuthUser,
  ): Promise<ChannelDto> {
    return this.channels.createChannel(body, user);
  }

  @Post('dm')
  @ApiOperation({ summary: 'Open (or reuse) a direct / group message' })
  createDm(
    @Body(new ZodValidationPipe(createDmSchema)) body: CreateDmInput,
    @CurrentUser() user: AuthUser,
  ): Promise<ChannelDto> {
    return this.channels.createDm(body, user);
  }

  @Post('from-incident')
  // The incident channel is a curated responder channel (docs/modules/13 §2); opening/joining it
  // must need the same authority that manages incidents, not merely chat.use — otherwise a chat-only
  // user could self-join and read an incident's coordination history they can't even open the card for.
  @RequirePermission('incidents.manage')
  @ApiOperation({ summary: 'Open (or create) the chat channel for an incident (incident manager)' })
  fromIncident(
    @Body(new ZodValidationPipe(channelFromIncidentSchema)) body: ChannelFromIncidentInput,
    @CurrentUser() user: AuthUser,
  ): Promise<ChannelDto> {
    return this.incidentChannels.openForIncident(body.incidentId, user);
  }

  @Get(':id')
  @ApiOperation({ summary: 'A channel with its members (member)' })
  get(@Param('id', uuidPipe) id: string, @CurrentUser() user: AuthUser): Promise<ChannelDto> {
    return this.channels.get(id, user);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Edit a channel — name / topic (admin)' })
  update(
    @Param('id', uuidPipe) id: string,
    @Body(new ZodValidationPipe(updateChannelSchema)) body: UpdateChannelInput,
    @CurrentUser() user: AuthUser,
  ): Promise<ChannelDto> {
    return this.channels.updateChannel(id, body, user);
  }

  @Post(':id/members')
  @ApiOperation({ summary: 'Join a public channel, or add a member (admin)' })
  addMember(
    @Param('id', uuidPipe) id: string,
    @Body(new ZodValidationPipe(addChannelMemberSchema)) body: AddChannelMemberInput,
    @CurrentUser() user: AuthUser,
  ): Promise<ChannelDto> {
    return this.channels.addMember(id, body, user);
  }

  @Delete(':id/members/:userId')
  @ApiOperation({ summary: 'Remove a member (admin) or leave (self)' })
  removeMember(
    @Param('id', uuidPipe) id: string,
    @Param('userId', uuidPipe) userId: string,
    @CurrentUser() user: AuthUser,
  ): Promise<void> {
    return this.channels.removeMember(id, userId, user);
  }

  @Post(':id/read')
  @ApiOperation({ summary: 'Mark read up to a message' })
  markRead(
    @Param('id', uuidPipe) id: string,
    @Body(new ZodValidationPipe(markReadSchema)) body: MarkReadInput,
    @CurrentUser() user: AuthUser,
  ): Promise<void> {
    return this.channels.markRead(id, body, user);
  }

  @Patch(':id/membership')
  @ApiOperation({ summary: 'My channel settings — notify level / pin' })
  updateMembership(
    @Param('id', uuidPipe) id: string,
    @Body(new ZodValidationPipe(updateMembershipSchema)) body: UpdateMembershipInput,
    @CurrentUser() user: AuthUser,
  ): Promise<void> {
    return this.channels.updateMembership(id, body, user);
  }
}
