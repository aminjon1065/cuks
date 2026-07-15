import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { readLog, users, type Database } from '@cuks/db';
import type { ReadLogEntityType, ReadLogEntryDto } from '@cuks/shared';
import { DB } from '../../common/db/db.module';
import { getRequestContext } from '../../common/request-context/request-context';

/**
 * ДСП access trail (docs/09-security.md §3, task 3.10). Every open of a restricted document —
 * and, when it lands, every download of its file — is appended to the append-only
 * `audit.read_log`. Writes are fire-and-forget and non-fatal, mirroring the audit sink: a
 * read-log failure must never break the read it records. Actor/ip/user-agent come from the
 * ambient request context.
 */
@Injectable()
export class ReadLogService {
  private readonly logger = new Logger('ReadLog');

  constructor(@Inject(DB) private readonly db: Database) {}

  /** Append one ДСП access. No-op when there is no resolvable actor (e.g. a system context). */
  record(entityType: ReadLogEntityType, entityId: string, actorId?: string): void {
    const ctx = getRequestContext();
    const actor = actorId ?? ctx?.actorId ?? null;
    if (!actor) return;
    void this.db
      .insert(readLog)
      .values({
        actorId: actor,
        entityType,
        entityId,
        ip: ctx?.ip ?? null,
        userAgent: ctx?.userAgent ?? null,
      })
      .catch((err: unknown) =>
        this.logger.error({ err, entityType, entityId }, 'failed to persist read-log'),
      );
  }

  /** The access trail for a document (its opens), newest first. */
  async listForDocument(documentId: string): Promise<ReadLogEntryDto[]> {
    const rows = await this.db
      .select({
        id: readLog.id,
        entityType: readLog.entityType,
        actorId: readLog.actorId,
        actorName: users.shortName,
        createdAt: readLog.createdAt,
      })
      .from(readLog)
      .leftJoin(users, eq(users.id, readLog.actorId))
      .where(and(eq(readLog.entityType, 'document'), eq(readLog.entityId, documentId)))
      .orderBy(desc(readLog.createdAt))
      .limit(200);
    return rows.map((r) => ({
      id: r.id,
      entityType: r.entityType as ReadLogEntityType,
      actorId: r.actorId,
      actorName: r.actorName ?? null,
      createdAt: r.createdAt.toISOString(),
    }));
  }
}
