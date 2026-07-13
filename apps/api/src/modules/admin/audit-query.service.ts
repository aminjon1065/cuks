import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, gte, like, lte, type SQL } from 'drizzle-orm';
import { type Database, auditLog, type AuditLogRow } from '@cuks/db';
import type { AuditLogDto, AuditLogQuery, PaginatedResult } from '@cuks/shared';
import { DB } from '../../common/db/db.module';

/** Read side of the audit log (docs/09 §5). Append-only table — query only. */
@Injectable()
export class AuditQueryService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async list(query: AuditLogQuery): Promise<PaginatedResult<AuditLogDto>> {
    const filters: SQL[] = [];
    if (query.actorId) filters.push(eq(auditLog.actorId, query.actorId));
    if (query.action) filters.push(like(auditLog.action, `${query.action}%`));
    if (query.entityType) filters.push(eq(auditLog.entityType, query.entityType));
    if (query.entityId) filters.push(eq(auditLog.entityId, query.entityId));
    if (query.from) filters.push(gte(auditLog.createdAt, new Date(query.from)));
    if (query.to) filters.push(lte(auditLog.createdAt, new Date(query.to)));
    const where = filters.length > 0 ? and(...filters) : undefined;

    const [totalRow] = await this.db.select({ total: count() }).from(auditLog).where(where);
    const rows = await this.db
      .select()
      .from(auditLog)
      .where(where)
      .orderBy(desc(auditLog.createdAt))
      .limit(query.limit)
      .offset((query.page - 1) * query.limit);

    return {
      items: rows.map((r) => this.toDto(r)),
      total: totalRow?.total ?? 0,
      page: query.page,
      limit: query.limit,
    };
  }

  private toDto(row: AuditLogRow): AuditLogDto {
    return {
      id: row.id,
      actorId: row.actorId,
      action: row.action,
      entityType: row.entityType,
      entityId: row.entityId,
      orgUnitId: row.orgUnitId,
      ip: row.ip,
      userAgent: row.userAgent,
      meta: row.meta,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
