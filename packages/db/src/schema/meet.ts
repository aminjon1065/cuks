import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { MEET_ROOM_ACCESS, MEET_ROOM_KINDS, MEETING_STATUS, RECORDING_STATUS } from '@cuks/shared';
import { appSchema, createdAt, deletedAt, primaryId, updatedAt } from './_shared';
import { chatChannels } from './chat';
import { users } from './users';

/**
 * A LiveKit room binding (docs/modules/14 §5, task 6.2). `livekit_room` is the SFU-side room name
 * the tokens are scoped to; `slug` is the permanent shareable handle (`/app/meet/r/{slug}`).
 * `channel_id` links a DM/channel call to its conversation (per §5 — a direct FK, not entity_links);
 * a partial unique index keeps at most one live room per channel so concurrent openers converge.
 */
export const meetRooms = appSchema.table(
  'meet_rooms',
  {
    id: primaryId(),
    slug: text('slug').notNull(),
    kind: text('kind', { enum: MEET_ROOM_KINDS }).notNull(),
    channelId: uuid('channel_id').references(() => chatChannels.id, { onDelete: 'set null' }),
    access: text('access', { enum: MEET_ROOM_ACCESS }).notNull().default('invited'),
    isActive: boolean('is_active').notNull().default(true),
    livekitRoom: text('livekit_room').notNull(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('meet_rooms_slug_uq').on(t.slug),
    uniqueIndex('meet_rooms_livekit_room_uq').on(t.livekitRoom),
    // One live room per channel — makes the advisory-lock reuse race-safe.
    uniqueIndex('meet_rooms_channel_active_uq')
      .on(t.channelId)
      .where(sql`${t.channelId} is not null and ${t.isActive}`),
  ],
);

/**
 * A scheduled conference (docs/modules/14 §5). `participants` is a polymorphic invite list
 * (`{users:uuid[], orgUnits:uuid[]}`), so it is jsonb — not a uuid[] like the call/recording rosters.
 * The meetings API (task 6.5) manages these; the table lands here so the schema is complete.
 */
export const meetings = appSchema.table(
  'meetings',
  {
    id: primaryId(),
    roomId: uuid('room_id').references(() => meetRooms.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    agenda: text('agenda'),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    durationMin: integer('duration_min'),
    organizerId: uuid('organizer_id').references(() => users.id, { onDelete: 'set null' }),
    participants: jsonb('participants')
      .notNull()
      .default(sql`'{}'::jsonb`),
    recordPlanned: boolean('record_planned').notNull().default(false),
    status: text('status', { enum: MEETING_STATUS }).notNull().default('scheduled'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    index('meetings_starts_idx').on(t.startsAt),
    index('meetings_organizer_idx').on(t.organizerId),
    index('meetings_status_idx').on(t.status),
  ],
);

/**
 * Call history (docs/modules/14 §5): one row per call session in a room, populated from LiveKit
 * webhooks (task 6.4/6.6). `participants` is the uuid[] roster; `max_concurrent` the peak headcount.
 */
export const meetCalls = appSchema.table(
  'meet_calls',
  {
    id: primaryId(),
    roomId: uuid('room_id')
      .notNull()
      .references(() => meetRooms.id, { onDelete: 'cascade' }),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    initiatorId: uuid('initiator_id').references(() => users.id, { onDelete: 'set null' }),
    participants: uuid('participants')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    maxConcurrent: integer('max_concurrent').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    index('meet_calls_room_idx').on(t.roomId, t.startedAt),
    index('meet_calls_participants_idx').using('gin', t.participants),
  ],
);

/**
 * A recording produced by LiveKit Egress (docs/modules/14 §4/§5, task 6.6). `size` is bytes (bigint —
 * a recording can exceed the int4 4 GB ceiling); `duration` seconds; both null until egress finishes.
 * `participants` is the uuid[] roster used to gate access to the file.
 */
export const recordings = appSchema.table(
  'recordings',
  {
    id: primaryId(),
    roomId: uuid('room_id').references(() => meetRooms.id, { onDelete: 'set null' }),
    meetingId: uuid('meeting_id').references(() => meetings.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    startedBy: uuid('started_by').references(() => users.id, { onDelete: 'set null' }),
    // LiveKit egress id — correlates the start-recording call with the egress_ended webhook (6.6).
    egressId: text('egress_id'),
    duration: integer('duration'),
    size: bigint('size', { mode: 'number' }),
    fileKey: text('file_key'),
    participants: uuid('participants')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    status: text('status', { enum: RECORDING_STATUS }).notNull().default('processing'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    index('recordings_meeting_idx').on(t.meetingId),
    index('recordings_room_idx').on(t.roomId),
    index('recordings_status_idx').on(t.status),
    uniqueIndex('recordings_egress_uq')
      .on(t.egressId)
      .where(sql`${t.egressId} is not null`),
  ],
);
