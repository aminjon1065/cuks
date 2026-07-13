import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  listNotificationsQuerySchema,
  notificationPrefsUpdateSchema,
  type ListNotificationsQuery,
  type NotificationDto,
  type NotificationPrefsDto,
  type NotificationPrefsUpdateInput,
  type PaginatedResult,
  type UnreadCountDto,
} from '@cuks/shared';
import type { AuthUser } from '../../common/auth/auth-user';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { NotificationsService } from './notifications.service';

const idParam = z.string().uuid();

/**
 * Own-notifications API (docs/07). No permission gate — every authenticated user
 * reads and manages their own feed; the service scopes every query to the caller.
 */
@ApiTags('notifications')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(listNotificationsQuerySchema)) query: ListNotificationsQuery,
  ): Promise<PaginatedResult<NotificationDto>> {
    return this.notifications.list(user.id, query);
  }

  @Get('unread-count')
  async unreadCount(@CurrentUser() user: AuthUser): Promise<UnreadCountDto> {
    return { count: await this.notifications.unreadCount(user.id) };
  }

  @Post(':id/read')
  @HttpCode(200)
  async markRead(
    @CurrentUser() user: AuthUser,
    @Param('id', new ZodValidationPipe(idParam)) id: string,
  ): Promise<{ ok: true }> {
    await this.notifications.markRead(user.id, id);
    return { ok: true };
  }

  @Post('read-all')
  @HttpCode(200)
  async markAllRead(@CurrentUser() user: AuthUser): Promise<{ ok: true }> {
    await this.notifications.markAllRead(user.id);
    return { ok: true };
  }

  @Get('prefs')
  async getPrefs(@CurrentUser() user: AuthUser): Promise<NotificationPrefsDto> {
    return { prefs: await this.notifications.getPrefs(user.id) };
  }

  @Patch('prefs')
  async updatePrefs(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(notificationPrefsUpdateSchema)) body: NotificationPrefsUpdateInput,
  ): Promise<NotificationPrefsDto> {
    return { prefs: await this.notifications.updatePrefs(user.id, body) };
  }
}
