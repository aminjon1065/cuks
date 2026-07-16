import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, desc, eq, isNull, or, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { meetRooms, recordings, users, type Database } from '@cuks/db';
import {
  MEET_MAX_CONCURRENT_RECORDINGS,
  type RecordingDto,
  type StartRecordingInput,
} from '@cuks/shared';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthUser } from '../../common/auth/auth-user';
import { DB } from '../../common/db/db.module';
import { AppException } from '../../common/exceptions/app.exception';
import { StorageService } from '../../common/storage/storage.service';
import { RealtimeService } from '../events/realtime.service';
import { LivekitService } from './livekit.service';

/** Advisory-lock namespace serializing the ≤2 concurrent-recording slot reservation. */
const MEET_REC_LOCK_NS = 4242007;

type RecordingRow = typeof recordings.$inferSelect;

/**
 * Meeting recordings (docs/modules/14 §4/§7, task 6.6). The host (with meet.record) starts/stops a
 * room-composite egress; the file lands in the `cuks` bucket under `recordings/` and its row is
 * completed by the `egress_ended` webhook. Access is a participant-membership check (the roster
 * snapshot at start + the starter) plus meet.recordings.manage; deletion is host/manage.
 */
@Injectable()
export class RecordingsService {
  private readonly logger = new Logger(RecordingsService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly livekit: LivekitService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
  ) {}

  /** Start recording the caller's room (host + meet.record; the controller gates meet.record). */
  async start(roomId: string, input: StartRecordingInput, user: AuthUser): Promise<RecordingDto> {
    const room = await this.requireHostRoom(roomId, user);
    if (!this.livekit.enabled) {
      throw AppException.serviceUnavailable('meet.unavailable', 'Calls are not configured');
    }
    // Roster snapshot: who is in the call may access the recording (docs/modules/14 §4).
    const roster = await this.livekit.participantIdentities(room.livekitRoom).catch(() => []);
    const participants = [...new Set([user.id, ...roster])];
    const title = input.title?.trim() || `Запись ${new Date().toISOString().slice(0, 16)}`;
    const recId = uuidv7();

    // Reserve a slot: the count + insert happen under one advisory lock so two simultaneous starts
    // can't both pass the ≤2 cap.
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(${MEET_REC_LOCK_NS})`);
      const counted = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(recordings)
        .where(and(eq(recordings.status, 'processing'), isNull(recordings.deletedAt)));
      if ((counted[0]?.count ?? 0) >= MEET_MAX_CONCURRENT_RECORDINGS) {
        throw AppException.conflict(
          'meet.recording.slots_full',
          'Запись начнётся после освобождения слота',
        );
      }
      await tx.insert(recordings).values({
        id: recId,
        roomId: room.id,
        title,
        startedBy: user.id,
        fileKey: `recordings/${recId}.mp4`,
        participants,
        status: 'processing',
      });
    });

    try {
      const egressId = await this.livekit.startRoomRecording(
        room.livekitRoom,
        `recordings/${recId}.mp4`,
      );
      await this.db.update(recordings).set({ egressId }).where(eq(recordings.id, recId));
    } catch (err) {
      // The egress didn't start — release the reserved slot.
      await this.db
        .update(recordings)
        .set({ status: 'failed' })
        .where(eq(recordings.id, recId))
        .catch(() => undefined);
      this.logger.error({ err }, 'failed to start egress');
      throw AppException.serviceUnavailable(
        'meet.recording.start_failed',
        'Could not start recording',
      );
    }

    this.audit.log({
      action: 'meet.recording_started',
      actorId: user.id,
      entityType: 'recording',
      entityId: recId,
      meta: { roomId: room.id },
    });
    const row = await this.requireRow(recId);
    this.emitState(row);
    return this.toDto(row, user);
  }

  /** Stop the room's active recording (host). The `egress_ended` webhook then flips it to ready. */
  async stop(roomId: string, user: AuthUser): Promise<void> {
    const room = await this.requireHostRoom(roomId, user);
    const [row] = await this.db
      .select()
      .from(recordings)
      .where(
        and(
          eq(recordings.roomId, room.id),
          eq(recordings.status, 'processing'),
          isNull(recordings.deletedAt),
        ),
      )
      .orderBy(desc(recordings.createdAt))
      .limit(1);
    if (!row) throw AppException.notFound('meet.recording.none_active', 'No active recording');
    if (row.egressId) await this.livekit.stopRecording(row.egressId);
    this.audit.log({
      action: 'meet.recording_stopped',
      actorId: user.id,
      entityType: 'recording',
      entityId: row.id,
    });
  }

  /** Recordings the caller may see (docs/modules/14 §4): manage → all; else the ones they were in. */
  async list(user: AuthUser): Promise<RecordingDto[]> {
    const alive = isNull(recordings.deletedAt);
    const where = canManageAll(user)
      ? alive
      : and(
          alive,
          or(eq(recordings.startedBy, user.id), sql`${user.id} = any(${recordings.participants})`),
        );
    const rows = await this.db
      .select()
      .from(recordings)
      .where(where)
      .orderBy(desc(recordings.createdAt));
    return Promise.all(rows.map((r) => this.toDto(r, user)));
  }

  async get(id: string, user: AuthUser): Promise<RecordingDto> {
    const row = await this.requireRow(id);
    this.assertCanView(row, user);
    return this.toDto(row, user);
  }

  /** Presigned inline URL for the player (no audit — a play/seek issues many range requests). */
  async streamUrl(id: string, user: AuthUser): Promise<string> {
    const row = await this.requireReady(id, user);
    return this.storage.getStreamUrl(row.fileKey as string);
  }

  /** Presigned attachment URL for an explicit download — audited (docs/modules/14 §4). */
  async downloadUrl(id: string, user: AuthUser): Promise<string> {
    const row = await this.requireReady(id, user);
    this.audit.log({
      action: 'meet.recording_downloaded',
      actorId: user.id,
      entityType: 'recording',
      entityId: row.id,
    });
    return this.storage.getDownloadUrl(row.fileKey as string, `${row.title}.mp4`);
  }

  /** Soft-delete + remove the object (host who started it, or meet.recordings.manage). */
  async remove(id: string, user: AuthUser): Promise<void> {
    const row = await this.requireRow(id);
    if (!(await this.canManage(row, user))) {
      throw AppException.forbidden(
        'meet.recording.forbidden',
        'Not allowed to delete this recording',
      );
    }
    await this.db
      .update(recordings)
      .set({ deletedAt: new Date() })
      .where(and(eq(recordings.id, id), isNull(recordings.deletedAt)));
    if (row.fileKey) await this.storage.deleteObject(row.fileKey).catch(() => undefined);
    this.audit.log({
      action: 'meet.recording_deleted',
      actorId: user.id,
      entityType: 'recording',
      entityId: id,
    });
  }

  // --- helpers ---

  private emitState(row: RecordingRow): void {
    const status = row.status;
    for (const userId of new Set([...(row.participants ?? []), row.startedBy].filter(Boolean))) {
      this.realtime.emitToUser(userId as string, 'meet.recording.state', {
        recordingId: row.id,
        roomId: row.roomId,
        status: status as 'processing' | 'ready' | 'failed',
      });
    }
  }

  private assertCanView(row: RecordingRow, user: AuthUser): void {
    const viewable =
      canManageAll(user) || row.startedBy === user.id || (row.participants ?? []).includes(user.id);
    if (!viewable) {
      throw AppException.forbidden(
        'meet.recording.forbidden',
        'Not allowed to view this recording',
      );
    }
  }

  private async requireReady(id: string, user: AuthUser): Promise<RecordingRow> {
    const row = await this.requireRow(id);
    this.assertCanView(row, user);
    if (row.status !== 'ready' || !row.fileKey) {
      throw AppException.conflict('meet.recording.not_ready', 'This recording is not ready');
    }
    return row;
  }

  private canManage(row: RecordingRow, user: AuthUser): boolean {
    return canManageAll(user) || row.startedBy === user.id;
  }

  private async requireRow(id: string): Promise<RecordingRow> {
    const [row] = await this.db
      .select()
      .from(recordings)
      .where(and(eq(recordings.id, id), isNull(recordings.deletedAt)))
      .limit(1);
    if (!row) throw AppException.notFound('meet.recording.not_found', 'Recording not found');
    return row;
  }

  /** Load the room and assert the caller is its host (only the host may record). */
  private async requireHostRoom(
    roomId: string,
    user: AuthUser,
  ): Promise<typeof meetRooms.$inferSelect> {
    const [room] = await this.db.select().from(meetRooms).where(eq(meetRooms.id, roomId)).limit(1);
    if (!room) throw AppException.notFound('meet.room.not_found', 'Room not found');
    if (room.createdBy !== user.id) {
      throw AppException.forbidden('meet.room.not_host', 'Only the host can record this call');
    }
    return room;
  }

  private async toDto(row: RecordingRow, user: AuthUser): Promise<RecordingDto> {
    const [starter] = row.startedBy
      ? await this.db
          .select({ name: users.shortName })
          .from(users)
          .where(eq(users.id, row.startedBy))
          .limit(1)
      : [];
    return {
      id: row.id,
      roomId: row.roomId,
      meetingId: row.meetingId,
      title: row.title,
      startedById: row.startedBy,
      startedByName: starter?.name ?? null,
      status: row.status,
      durationSec: row.duration,
      sizeBytes: row.size,
      participantCount: (row.participants ?? []).length,
      createdAt: row.createdAt.toISOString(),
      canManage: this.canManage(row, user),
    };
  }
}

/** meet.recordings.manage (or superadmin) sees + manages every recording. */
function canManageAll(user: AuthUser): boolean {
  return user.isSuperadmin || user.permissions.includes('meet.recordings.manage');
}
