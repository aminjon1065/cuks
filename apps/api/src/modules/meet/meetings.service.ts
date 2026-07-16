import { randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { and, asc, desc, eq, gte, inArray, isNull, lt, ne, or } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { meetRooms, meetings, positions, userPositions, users, type Database } from '@cuks/db';
import {
  QUEUE,
  type CreateMeetingInput,
  type MeetReminderJobData,
  type MeetingDto,
  type MeetingParticipants,
  type MeetingsRange,
  type UpdateMeetingInput,
} from '@cuks/shared';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthUser } from '../../common/auth/auth-user';
import { DB } from '../../common/db/db.module';
import { AppException } from '../../common/exceptions/app.exception';
import { NotificationsService } from '../notifications/notifications.service';

/** Asia/Dushanbe is UTC+5, no DST (docs/04 §Time) — the same constant the deadlines/notifications use. */
const DUSHANBE_OFFSET_MS = 5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const REMINDER_LEAD_MS = 15 * 60 * 1000;
/** BullMQ custom job ids may not contain ':'. */
const reminderJobId = (id: string): string => `meet-reminder-${id}`;
const newSlug = (): string => randomBytes(8).toString('hex');

type MeetingRow = typeof meetings.$inferSelect;

/**
 * Scheduled meetings (docs/modules/14 §2/§5/§7, task 6.5): a meeting owns a persistent link-access
 * room (`kind: 'meeting'`) and an invitee list ({users, orgUnits}). Creating/rescheduling notifies the
 * invitees and (re)arms a delayed «15 minutes before» reminder; only the organizer may edit or cancel.
 */
@Injectable()
export class MeetingsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @InjectQueue(QUEUE.meetReminder) private readonly reminderQueue: Queue<MeetReminderJobData>,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  async create(input: CreateMeetingInput, user: AuthUser): Promise<MeetingDto> {
    const roomId = uuidv7();
    const meetingId = uuidv7();
    const startsAt = new Date(input.startsAt);

    await this.db.transaction(async (tx) => {
      await tx.insert(meetRooms).values({
        id: roomId,
        slug: newSlug(),
        kind: 'meeting',
        channelId: null,
        // Link access — invitees join by the meeting link (docs/modules/14 §2). A members-only room
        // (access 'invited') would 403 every invitee except the organizer at token mint.
        access: 'link',
        livekitRoom: `meet-${roomId}`,
        createdBy: user.id,
      });
      await tx.insert(meetings).values({
        id: meetingId,
        roomId,
        title: input.title,
        agenda: input.agenda ?? null,
        startsAt,
        durationMin: input.durationMin,
        organizerId: user.id,
        participants: input.participants,
        recordPlanned: input.recordPlanned,
      });
    });

    this.audit.log({
      action: 'meet.meeting.created',
      actorId: user.id,
      entityType: 'meeting',
      entityId: meetingId,
      meta: { roomId, startsAt: startsAt.toISOString() },
    });

    const row = await this.requireRow(meetingId);
    await this.notifyInvited(row, 'invited');
    await this.armReminder(row);
    return this.toDto(row, user);
  }

  async list(range: MeetingsRange, user: AuthUser): Promise<MeetingDto[]> {
    const { start, end } = dushanbeDayWindow(new Date());
    const alive = isNull(meetings.deletedAt);
    const myOrgUnits = await this.userOrgUnitIds(user.id);

    const where =
      range === 'today'
        ? and(
            alive,
            ne(meetings.status, 'cancelled'),
            gte(meetings.startsAt, start),
            lt(meetings.startsAt, end),
          )
        : range === 'upcoming'
          ? and(alive, ne(meetings.status, 'cancelled'), gte(meetings.startsAt, end))
          : and(
              alive,
              or(inArray(meetings.status, ['done', 'cancelled']), lt(meetings.startsAt, start)),
            );
    const order = range === 'past' ? desc(meetings.startsAt) : asc(meetings.startsAt);

    const rows = await this.db.select().from(meetings).where(where).orderBy(order);
    const visible = rows.filter((r) => canSee(r, user.id, myOrgUnits));
    return Promise.all(visible.map((r) => this.toDto(r, user)));
  }

  async get(id: string, user: AuthUser): Promise<MeetingDto> {
    const row = await this.requireRow(id);
    if (!canSee(row, user.id, await this.userOrgUnitIds(user.id))) {
      throw AppException.forbidden('meet.meeting.forbidden', 'Not invited to this meeting');
    }
    return this.toDto(row, user);
  }

  /** Edit fields or cancel (organizer only). `status: 'cancelled'` cancels and drops the reminder. */
  async patch(id: string, input: UpdateMeetingInput, user: AuthUser): Promise<MeetingDto> {
    const row = await this.requireRow(id);
    if (row.organizerId !== user.id) {
      throw AppException.forbidden('meet.meeting.not_organizer', 'Only the organizer can edit');
    }
    if (row.status !== 'scheduled') {
      throw AppException.conflict('meet.meeting.closed', 'This meeting is no longer editable');
    }

    const patch: Partial<typeof meetings.$inferInsert> = {};
    if (input.title !== undefined) patch.title = input.title;
    if (input.agenda !== undefined) patch.agenda = input.agenda ?? null;
    if (input.startsAt !== undefined) patch.startsAt = new Date(input.startsAt);
    if (input.durationMin !== undefined) patch.durationMin = input.durationMin;
    if (input.participants !== undefined) patch.participants = input.participants;
    if (input.recordPlanned !== undefined) patch.recordPlanned = input.recordPlanned;
    const cancelling = input.status === 'cancelled';
    if (cancelling) patch.status = 'cancelled';

    await this.db.update(meetings).set(patch).where(eq(meetings.id, id));
    const updated = await this.requireRow(id);

    if (cancelling) {
      await this.disarmReminder(id);
      await this.db
        .update(meetRooms)
        .set({ isActive: false })
        .where(eq(meetRooms.id, updated.roomId as string));
      this.audit.log({
        action: 'meet.meeting.cancelled',
        actorId: user.id,
        entityType: 'meeting',
        entityId: id,
      });
      await this.notifyInvited(updated, 'cancelled');
    } else {
      this.audit.log({
        action: 'meet.meeting.updated',
        actorId: user.id,
        entityType: 'meeting',
        entityId: id,
      });
      // Re-arm the reminder against the (possibly new) start time.
      await this.armReminder(updated);
      if (input.startsAt !== undefined) await this.notifyInvited(updated, 'updated');
    }
    return this.toDto(updated, user);
  }

  /** Fired by MeetReminderProcessor 15 min before start — notify invitees, unless it's off/cancelled. */
  async remind(meetingId: string): Promise<void> {
    const [row] = await this.db
      .select()
      .from(meetings)
      .where(and(eq(meetings.id, meetingId), isNull(meetings.deletedAt)))
      .limit(1);
    if (!row || row.status !== 'scheduled') return;
    await this.notifyInvited(row, 'reminder');
  }

  // --- helpers ---

  /** The org units the user belongs to (via their positions) — for org-unit meeting invites. */
  private async userOrgUnitIds(userId: string): Promise<Set<string>> {
    const rows = await this.db
      .selectDistinct({ orgUnitId: positions.orgUnitId })
      .from(userPositions)
      .innerJoin(
        positions,
        and(eq(positions.id, userPositions.positionId), isNull(positions.deletedAt)),
      )
      .where(eq(userPositions.userId, userId));
    return new Set(rows.map((r) => r.orgUnitId));
  }

  private async requireRow(id: string): Promise<MeetingRow> {
    const [row] = await this.db
      .select()
      .from(meetings)
      .where(and(eq(meetings.id, id), isNull(meetings.deletedAt)))
      .limit(1);
    if (!row) throw AppException.notFound('meet.meeting.not_found', 'Meeting not found');
    return row;
  }

  /** Resolve the invitee list ({users, orgUnits}) to a deduped set of active user ids. */
  private async resolveParticipantIds(participants: MeetingParticipants): Promise<Set<string>> {
    const ids = new Set<string>(participants.users);
    if (participants.orgUnits.length > 0) {
      const rows = await this.db
        .selectDistinct({ userId: userPositions.userId })
        .from(userPositions)
        .innerJoin(
          positions,
          and(eq(positions.id, userPositions.positionId), isNull(positions.deletedAt)),
        )
        .innerJoin(
          users,
          and(
            eq(users.id, userPositions.userId),
            eq(users.status, 'active'),
            isNull(users.deletedAt),
          ),
        )
        .where(inArray(positions.orgUnitId, participants.orgUnits));
      for (const r of rows) ids.add(r.userId);
    }
    return ids;
  }

  private async notifyInvited(
    row: MeetingRow,
    kind: 'invited' | 'updated' | 'cancelled' | 'reminder',
  ): Promise<void> {
    const recipients = await this.resolveParticipantIds(participantsOf(row));
    if (row.organizerId) recipients.add(row.organizerId);
    if (recipients.size === 0) return;
    const titles = {
      invited: 'Приглашение на совещание',
      updated: 'Совещание изменено',
      cancelled: 'Совещание отменено',
      reminder: 'Совещание через 15 минут',
    } as const;
    await this.notifications.notifyMany({
      userIds: [...recipients],
      type: `meet.meeting.${kind}`,
      title: titles[kind],
      body: row.title,
      entityType: 'meeting',
      entityId: row.id,
      priority: 'normal',
      // Reminders/cancellations are time-sensitive-in-app only; an invite may email an offline user.
      emailMode: kind === 'invited' ? 'offline' : 'never',
      dedupeKey: `meet:meeting:${row.id}:${kind}`,
    });
  }

  /** (Re)schedule the 15-min reminder for `startsAt`; a stale job for this meeting is replaced. */
  private async armReminder(row: MeetingRow): Promise<void> {
    await this.disarmReminder(row.id);
    const delay = row.startsAt.getTime() - REMINDER_LEAD_MS - Date.now();
    if (delay <= 0) return; // starts within 15 min (or in the past) — no reminder to schedule
    await this.reminderQueue.add(
      'remind',
      { meetingId: row.id },
      { delay, jobId: reminderJobId(row.id) },
    );
  }

  private async disarmReminder(meetingId: string): Promise<void> {
    await this.reminderQueue.remove(reminderJobId(meetingId)).catch(() => undefined);
  }

  private async toDto(row: MeetingRow, user: AuthUser): Promise<MeetingDto> {
    const participants = participantsOf(row);
    const [ids, room, organizer] = await Promise.all([
      this.resolveParticipantIds(participants),
      row.roomId
        ? this.db
            .select({ slug: meetRooms.slug })
            .from(meetRooms)
            .where(eq(meetRooms.id, row.roomId))
            .limit(1)
        : Promise.resolve([]),
      row.organizerId
        ? this.db
            .select({ name: users.shortName })
            .from(users)
            .where(eq(users.id, row.organizerId))
            .limit(1)
        : Promise.resolve([]),
    ]);
    return {
      id: row.id,
      roomId: row.roomId ?? '',
      slug: room[0]?.slug ?? '',
      title: row.title,
      agenda: row.agenda,
      startsAt: row.startsAt.toISOString(),
      durationMin: row.durationMin ?? 0,
      organizerId: row.organizerId,
      organizerName: organizer[0]?.name ?? null,
      participants,
      participantCount: ids.size,
      recordPlanned: row.recordPlanned,
      status: row.status,
      canManage: row.organizerId === user.id,
    };
  }
}

/** May the user see this meeting — organizer, an explicit invitee, or a member of an invited org unit. */
function canSee(row: MeetingRow, userId: string, userOrgUnits: Set<string>): boolean {
  if (row.organizerId === userId) return true;
  const p = participantsOf(row);
  if (p.users.includes(userId)) return true;
  return p.orgUnits.some((ou) => userOrgUnits.has(ou));
}

/** meetings.participants is untyped jsonb — normalise it to the {users, orgUnits} shape. */
function participantsOf(row: MeetingRow): MeetingParticipants {
  const p = (row.participants ?? {}) as Partial<MeetingParticipants>;
  return { users: p.users ?? [], orgUnits: p.orgUnits ?? [] };
}

/** [startOfTodayUTC, startOfTomorrowUTC) for the Asia/Dushanbe calendar day containing `now`. */
export function dushanbeDayWindow(now: Date): { start: Date; end: Date } {
  const localMidnight = new Date(now.getTime() + DUSHANBE_OFFSET_MS);
  localMidnight.setUTCHours(0, 0, 0, 0);
  const start = new Date(localMidnight.getTime() - DUSHANBE_OFFSET_MS);
  return { start, end: new Date(start.getTime() + DAY_MS) };
}
