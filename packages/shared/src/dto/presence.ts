import { z } from 'zod';

/**
 * User presence (docs/modules/13 §4): online while a socket is connected and the user was active
 * within the last 10 minutes; away while connected but idle; offline otherwise. Status is derived at
 * read time from Redis-backed socket liveness + the last user-activity ping.
 */
export const PRESENCE_STATUSES = ['online', 'away', 'offline'] as const;
export type PresenceStatus = (typeof PRESENCE_STATUSES)[number];

/** Connected users count as away once idle this long. */
export const PRESENCE_AWAY_AFTER_MS = 10 * 60 * 1000;

export interface PresenceStatusDto {
  userId: string;
  status: PresenceStatus;
  /** Last user-activity ping (ISO), or null if none recorded. */
  activityAt: string | null;
}

/** `GET /presence?userIds=a,b,c` — bulk lookup for member lists / DM rows. */
export const presenceQuerySchema = z.object({
  userIds: z
    .string()
    .transform((s) => s.split(',').filter(Boolean))
    .pipe(z.array(z.string().uuid()).min(1).max(100)),
});
export type PresenceQuery = z.infer<typeof presenceQuerySchema>;
