import { Inject, Injectable } from '@nestjs/common';
import { and, isNull, sql } from 'drizzle-orm';
import { documentDispatches, documents, resolutions, type Database } from '@cuks/db';
import type { AttentionCountsDto, AttentionQueue } from '@cuks/shared';
import type { AuthUser } from '../../common/auth/auth-user';
import { DB } from '../../common/db/db.module';
import { visibleDocumentsWhere } from './document-visibility';
import { AcknowledgementsService } from './acknowledgements.service';
import { ResolutionsService } from './resolutions.service';
import { RoutesService } from './routes.service';

/**
 * «Требует внимания» (plan §8.8) — what the dashboard puts in front of a person the moment
 * they log in.
 *
 * Two rules.
 *
 * **Counts are counted, not measured.** The queue badges used to fetch every matching document
 * id and read `.length`; on a register of two hundred thousand that ships thousands of uuids
 * over the wire to produce one integer. Every count here is a `count(*)` the database answers,
 * and the four document-wide ones share a single scan through `count(*) filter`.
 *
 * **A queue the caller may not see is absent, not zero.** «Кандидаты к выбытию: 0» still tells
 * somebody without the right that the archive has a disposal queue and that it happens to be
 * empty today. The widget renders what it is given.
 */
@Injectable()
export class AttentionService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly routes: RoutesService,
    private readonly resolutions: ResolutionsService,
    private readonly acknowledgements: AcknowledgementsService,
  ) {}

  async counts(actor: AuthUser): Promise<AttentionCountsDto> {
    const assignments = await this.routes.actingAssignments(actor.id);
    const visible = visibleDocumentsWhere(actor, assignments);
    const base = and(isNull(documents.deletedAt), visible);

    // An open document is one whose work has not finished: `completed`, `archived` and the
    // dead ends owe nobody anything, so nothing about them can be late.
    const open = sql`${documents.status} in ('registered', 'in_progress', 'on_route', 'pending_registration')`;
    const overdue = sql`${documents.dueDate} is not null and ${documents.dueDate} < now() and ${open}`;
    // Registered outgoing correspondence that has not left the building: no dispatch attempt
    // has succeeded and none is still in flight.
    const awaitingDispatch = sql`${documents.docClass} = 'outgoing'
      and ${documents.regNumber} is not null
      and ${open}
      and not exists (select 1 from ${documentDispatches} d
        where d.document_id = ${documents.id} and d.status in ('sent', 'pending'))`;
    // An incoming letter that is registered and has been given no instruction yet — the thing
    // the chancellery is waiting on somebody to look at.
    const newIncoming = sql`${documents.docClass} = 'incoming'
      and ${documents.status} = 'registered'
      and not exists (select 1 from ${resolutions} r where r.document_id = ${documents.id})`;
    const candidates = sql`${documents.dispositionStatus} = 'candidate'`;

    const [wide, approve, sign, ack, tasks] = await Promise.all([
      // One scan of the visible register answers all four document-wide questions.
      this.db
        .select({
          overdue: sql<number>`count(*) filter (where ${overdue})::int`,
          awaitingDispatch: sql<number>`count(*) filter (where ${awaitingDispatch})::int`,
          newIncoming: sql<number>`count(*) filter (where ${newIncoming})::int`,
          candidates: sql<number>`count(*) filter (where ${candidates})::int`,
        })
        .from(documents)
        .where(base),
      this.routes.approvalQueueCount(actor.id),
      this.routes.signQueueCount(actor.id),
      this.acknowledgements.toAcknowledgeCount(actor.id),
      this.resolutions.myTasksCount(actor.id),
    ]);

    const row = wide[0];
    const counts: Partial<Record<AttentionQueue, number>> = {
      to_approve: approve,
      to_sign: sign,
      to_acknowledge: ack,
      my_tasks: tasks,
      overdue: row?.overdue ?? 0,
      new_incoming: row?.newIncoming ?? 0,
    };
    // Dispatch is chancellery work; showing the backlog to everybody would be noise on most
    // dashboards and a hint about the register on the rest.
    if (actor.isSuperadmin || actor.permissions.includes('docflow.register')) {
      counts.awaiting_dispatch = row?.awaitingDispatch ?? 0;
    }
    if (actor.isSuperadmin || actor.permissions.includes('docflow.archive.dispose')) {
      counts.disposition_candidates = row?.candidates ?? 0;
    }
    return { counts };
  }
}

/** The queue a count links to, as a documents-list query. Exported for the controller's docs. */
export const ATTENTION_DRILLDOWN: Record<AttentionQueue, string> = {
  to_approve: 'queue=to_approve',
  to_sign: 'queue=to_sign',
  to_acknowledge: 'queue=to_acknowledge',
  my_tasks: 'queue=my_tasks',
  overdue: 'queue=mine&overdue=true',
  awaiting_dispatch: 'queue=registry&docClass=outgoing&awaitingDispatch=true',
  new_incoming: 'queue=registry&docClass=incoming&status=registered',
  disposition_candidates: 'candidatesOnly=true',
};
