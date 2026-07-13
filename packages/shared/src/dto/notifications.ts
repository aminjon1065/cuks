import { z } from 'zod';
import {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_GROUPS,
  type NotificationChannel,
  type NotificationGroup,
} from '../notifications/index';

/** GET /notifications — paged feed, optionally filtered to unread / one group. */
export const listNotificationsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  // Query strings only — avoid z.coerce.boolean (which turns "false" into true).
  unread: z.preprocess(
    (v) => (v === undefined ? undefined : v === 'true' || v === true),
    z.boolean().optional(),
  ),
  group: z.enum(NOTIFICATION_GROUPS).optional(),
});
export type ListNotificationsQuery = z.infer<typeof listNotificationsQuerySchema>;

export interface NotificationDto {
  id: string;
  type: string;
  group: NotificationGroup;
  title: string;
  body: string;
  entityType: string | null;
  entityId: string | null;
  isRead: boolean;
  readAt: string | null;
  createdAt: string;
}

export interface UnreadCountDto {
  count: number;
}

/** One cell of the preferences matrix; `locked` = in-app of a critical group. */
export interface NotificationPrefDto {
  typeGroup: NotificationGroup;
  channel: NotificationChannel;
  enabled: boolean;
  locked: boolean;
}

export interface NotificationPrefsDto {
  prefs: NotificationPrefDto[];
}

/** PATCH /notifications/prefs — upsert a batch of (group, channel) toggles. */
export const notificationPrefsUpdateSchema = z.object({
  updates: z
    .array(
      z.object({
        typeGroup: z.enum(NOTIFICATION_GROUPS),
        channel: z.enum(NOTIFICATION_CHANNELS),
        enabled: z.boolean(),
      }),
    )
    .min(1)
    .max(NOTIFICATION_GROUPS.length * NOTIFICATION_CHANNELS.length),
});
export type NotificationPrefsUpdateInput = z.infer<typeof notificationPrefsUpdateSchema>;
