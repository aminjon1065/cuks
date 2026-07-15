import { Inject, Injectable } from '@nestjs/common';
import { aliasedTable, and, asc, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import { documents, resolutions, users, type Database } from '@cuks/db';
import { deadlineSeverity, type ControlItemDto } from '@cuks/shared';
import type { AuthUser } from '../../common/auth/auth-user';
import { DB } from '../../common/db/db.module';
import { canViewDocumentBase } from './document-visibility';

const executor = aliasedTable(users, 'ctrl_executor');
const author = aliasedTable(users, 'ctrl_author');

/** Whether the caller may extend / remove a resolution from control (docs/modules/11 §5). */
function canManageControl(actor: AuthUser, authorId: string): boolean {
  return (
    authorId === actor.id || actor.isSuperadmin || actor.permissions.includes('docflow.control')
  );
}

/**
 * Execution control view (docs/modules/11 §5, task 3.8): everything on control — resolutions
 * with `is_control` and documents with a `due_date` — with a deadline severity. Gated at the
 * controller by `docflow.control`; ДСП documents the caller cannot base-view are still hidden
 * (no subject leak).
 */
@Injectable()
export class ControlService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async list(actor: AuthUser): Promise<ControlItemDto[]> {
    const now = new Date();

    const resRows = await this.db
      .select({
        res: resolutions,
        doc: documents,
        executorName: executor.shortName,
        authorName: author.shortName,
      })
      .from(resolutions)
      .innerJoin(
        documents,
        and(eq(documents.id, resolutions.documentId), isNull(documents.deletedAt)),
      )
      .leftJoin(executor, eq(executor.id, resolutions.executorId))
      .leftJoin(author, eq(author.id, resolutions.authorId))
      .where(and(eq(resolutions.isControl, true), eq(resolutions.status, 'active')))
      .orderBy(asc(resolutions.dueDate));

    const docRows = await this.db
      .select({ doc: documents, authorName: author.shortName })
      .from(documents)
      .leftJoin(author, eq(author.id, documents.authorId))
      .where(
        and(
          isNull(documents.deletedAt),
          isNotNull(documents.dueDate),
          inArray(documents.status, ['registered', 'in_progress']),
        ),
      )
      .orderBy(asc(documents.dueDate));

    const items: ControlItemDto[] = [];
    for (const r of resRows) {
      if (!canViewDocumentBase(r.doc, actor)) continue;
      const dueDate = r.res.dueDate?.toISOString() ?? null;
      items.push({
        kind: 'resolution',
        id: r.res.id,
        documentId: r.doc.id,
        regNumber: r.doc.regNumber,
        subject: r.doc.subject,
        documentStatus: r.doc.status,
        resolutionText: r.res.text,
        executorName: r.executorName ?? null,
        authorName: r.authorName ?? null,
        dueDate,
        severity: deadlineSeverity(dueDate, now),
        canManage: canManageControl(actor, r.res.authorId),
      });
    }
    for (const d of docRows) {
      if (!canViewDocumentBase(d.doc, actor)) continue;
      const dueDate = d.doc.dueDate?.toISOString() ?? null;
      items.push({
        kind: 'document',
        id: d.doc.id,
        documentId: d.doc.id,
        regNumber: d.doc.regNumber,
        subject: d.doc.subject,
        documentStatus: d.doc.status,
        resolutionText: null,
        executorName: null,
        authorName: d.authorName ?? null,
        dueDate,
        severity: deadlineSeverity(dueDate, now),
        canManage: false,
      });
    }

    // Soonest deadlines first; nulls (no due date) last.
    return items.sort((a, b) => {
      if (a.dueDate === b.dueDate) return 0;
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return a.dueDate < b.dueDate ? -1 : 1;
    });
  }
}
