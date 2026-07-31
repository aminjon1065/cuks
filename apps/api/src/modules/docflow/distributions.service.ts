import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  acquaintanceBatches,
  acquaintances,
  documents,
  orgUnits,
  positions,
  userPositions,
  users,
  type Database,
} from '@cuks/db';
import {
  wsRooms,
  type CreateDistributionInput,
  type DistributionDto,
  type DistributionTargetInput,
  type WsEventPayloads,
} from '@cuks/shared';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthUser } from '../../common/auth/auth-user';
import { AppException } from '../../common/exceptions/app.exception';
import { DB } from '../../common/db/db.module';
import { NotificationsService } from '../notifications/notifications.service';
import { RealtimeService } from '../events/realtime.service';
import {
  assertDocumentDistributable,
  assertHasReaders,
  foldReaders,
  restrictToAllowList,
  type ResolvedReader,
} from './distribution-policy';
import { DocumentsService } from './documents.service';
import { hasRegistryAccess } from './document-visibility';

/**
 * Distributing an internal document for acknowledgement (docs/modules/11 §12.4, plan этап 7).
 *
 * Reuses the acquaintance machinery built for the route sheet and the pre-execution gate
 * rather than growing a third one: a distribution is an `acquaintance_batches` row of kind
 * `distribution` with its lines in `acquaintances`, so «На ознакомление», the card, the
 * obligation check and the existing acknowledge endpoint all see it without knowing it
 * exists.
 *
 * Targets are resolved to concrete people ONCE, at distribution time. Whoever is hired into
 * the subdivision tomorrow is not added to yesterday's sheet: an order is addressed to the
 * people who were there when it was issued, and retroactively growing the list would make
 * every past sheet quietly incomplete.
 */
@Injectable()
export class DistributionsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly documents: DocumentsService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeService,
  ) {}

  private emitUpdated(
    documentId: string,
    action: WsEventPayloads['docflow.distribution.updated']['action'],
    actorId: string | null,
  ): void {
    this.realtime.emitToRoom(
      wsRooms.entity('document', documentId),
      'docflow.distribution.updated',
      { documentId, action, actorId },
    );
  }

  async list(documentId: string, actor: AuthUser): Promise<DistributionDto[]> {
    await this.documents.assertVisible(documentId, actor);
    const batches = await this.db
      .select({
        b: acquaintanceBatches,
        createdByName: users.shortName,
      })
      .from(acquaintanceBatches)
      .leftJoin(users, eq(users.id, acquaintanceBatches.createdBy))
      .where(
        and(
          eq(acquaintanceBatches.documentId, documentId),
          eq(acquaintanceBatches.kind, 'distribution'),
        ),
      )
      .orderBy(desc(acquaintanceBatches.createdAt));
    return Promise.all(batches.map((row) => this.toDto(row.b, row.createdByName ?? null, actor)));
  }

  /**
   * Send the document round. One transaction: the batch and every line land together, so a
   * distribution can never exist with half its readers.
   */
  async create(
    documentId: string,
    input: CreateDistributionInput,
    actor: AuthUser,
  ): Promise<DistributionDto> {
    const doc = await this.documents.assertVisible(documentId, actor);
    assertDocumentDistributable(doc);
    if (doc.authorId !== actor.id && !hasRegistryAccess(actor)) {
      throw AppException.forbidden(
        'docflow.distribution.forbidden',
        'Only the author or the chancellery distributes a document',
      );
    }

    const expansions = [];
    for (const target of input.targets) {
      expansions.push({ target, userIds: await this.expandTarget(target) });
    }
    // A ДСП order reaches only its allow-list, whatever the targets said: being on the sheet
    // is participation, and participation must never widen a ДСП document (docs/09 §3).
    const { readers, excluded } = restrictToAllowList(foldReaders(expansions), doc);
    assertHasReaders(readers);

    const now = new Date();
    const releaseAt = input.dueAt ? new Date(input.dueAt) : null;
    if (releaseAt && releaseAt.getTime() <= now.getTime()) {
      // A deadline already past would be swept within the minute and mark everyone
      // `expired` before anyone could open the document — a sheet that fails on arrival.
      throw AppException.unprocessable(
        'docflow.distribution.due_in_past',
        'The acknowledgement deadline is already past',
      );
    }
    const batchId = await this.db.transaction(async (tx) => {
      const [batch] = await tx
        .insert(acquaintanceBatches)
        .values({
          documentId,
          kind: 'distribution',
          releaseAt,
          createdBy: actor.id,
        })
        .returning({ id: acquaintanceBatches.id });
      if (!batch) throw new Error('Distribution insert did not return a row');

      await tx.insert(acquaintances).values(
        readers.map((r: ResolvedReader) => ({
          documentId,
          batchId: batch.id,
          userId: r.userId,
          status: 'pending' as const,
          notifiedAt: now,
        })),
      );
      return batch.id;
    });

    await this.audit.logAndWait({
      action: 'docflow.distribution.created',
      actorId: actor.id,
      entityType: 'document',
      entityId: documentId,
      meta: {
        batchId,
        readers: readers.length,
        targets: input.targets.length,
        // Named in the audit: the operator addressed more people than the ДСП list admits,
        // and the difference between «направил отделу» and «дошло до троих» must be on record.
        ...(excluded > 0 ? { excludedByAccessList: excluded } : {}),
      },
    });
    for (const reader of readers) {
      void this.notifications.notify({
        userId: reader.userId,
        type: 'docflow.acquaintance.assigned',
        title: 'Ознакомьтесь с документом',
        // Never the subject: an internal order may be ДСП (docs/09 §3).
        body: `Вам направлен документ ${doc.regNumber ?? ''} для ознакомления.`.trim(),
        entityType: 'document',
        entityId: documentId,
        priority: 'normal',
        emailMode: 'offline',
      });
    }
    this.emitUpdated(documentId, 'created', actor.id);

    const [created] = await this.db
      .select({ b: acquaintanceBatches, createdByName: users.shortName })
      .from(acquaintanceBatches)
      .leftJoin(users, eq(users.id, acquaintanceBatches.createdBy))
      .where(eq(acquaintanceBatches.id, batchId))
      .limit(1);
    if (!created) throw new Error('Distribution vanished after creation');
    return this.toDto(created.b, created.createdByName ?? null, actor);
  }

  /**
   * Resolve one target to the people it reaches, right now.
   *
   * `org_unit` walks the subtree only when asked: «отделу» and «управлению со всеми
   * отделами» are different instructions, and quietly choosing the wider one would put an
   * order in front of people the author never addressed.
   */
  private async expandTarget(target: DistributionTargetInput): Promise<string[]> {
    // Only an account that can actually read counts — a blocked user on the sheet would
    // hold the batch open forever.
    const actable = and(eq(users.status, 'active'), isNull(users.deletedAt));
    if (target.type === 'user') {
      const [row] = await this.db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.id, target.id), actable))
        .limit(1);
      return row ? [row.id] : [];
    }
    if (target.type === 'position') {
      const rows = await this.db
        .select({ userId: userPositions.userId })
        .from(userPositions)
        .innerJoin(
          positions,
          and(eq(positions.id, userPositions.positionId), isNull(positions.deletedAt)),
        )
        .innerJoin(users, and(eq(users.id, userPositions.userId), actable))
        .where(eq(userPositions.positionId, target.id));
      return rows.map((r) => r.userId);
    }

    const unitIds = target.includeSubtree
      ? await this.subtreeUnitIds(target.id)
      : [await this.requireUnitId(target.id)];
    const rows = await this.db
      .select({ userId: userPositions.userId })
      .from(userPositions)
      .innerJoin(
        positions,
        and(eq(positions.id, userPositions.positionId), isNull(positions.deletedAt)),
      )
      .innerJoin(users, and(eq(users.id, userPositions.userId), actable))
      .where(inArray(positions.orgUnitId, unitIds));
    return rows.map((r) => r.userId);
  }

  /** The unit itself plus every descendant, via the materialized path (docs/05 §2). */
  private async subtreeUnitIds(orgUnitId: string): Promise<string[]> {
    const [unit] = await this.db
      .select({ id: orgUnits.id, path: orgUnits.path })
      .from(orgUnits)
      .where(and(eq(orgUnits.id, orgUnitId), isNull(orgUnits.deletedAt)))
      .limit(1);
    if (!unit) {
      throw AppException.notFound('docflow.org_unit.not_found', 'Subdivision not found');
    }
    const rows = await this.db
      .select({ id: orgUnits.id })
      .from(orgUnits)
      .where(and(sql`${orgUnits.path} like ${unit.path + '.%'}`, isNull(orgUnits.deletedAt)));
    return [unit.id, ...rows.map((r) => r.id)];
  }

  private async requireUnitId(orgUnitId: string): Promise<string> {
    const [unit] = await this.db
      .select({ id: orgUnits.id })
      .from(orgUnits)
      .where(and(eq(orgUnits.id, orgUnitId), isNull(orgUnits.deletedAt)))
      .limit(1);
    if (!unit) {
      throw AppException.notFound('docflow.org_unit.not_found', 'Subdivision not found');
    }
    return unit.id;
  }

  private async toDto(
    batch: typeof acquaintanceBatches.$inferSelect,
    createdByName: string | null,
    actor: AuthUser,
  ): Promise<DistributionDto> {
    const rows = await this.db
      .select({
        userId: acquaintances.userId,
        userName: users.shortName,
        position: positions.name,
        status: acquaintances.status,
        acknowledgedAt: acquaintances.acknowledgedAt,
      })
      .from(acquaintances)
      .leftJoin(users, eq(users.id, acquaintances.userId))
      .leftJoin(
        userPositions,
        and(eq(userPositions.userId, acquaintances.userId), eq(userPositions.isPrimary, true)),
      )
      .leftJoin(positions, eq(positions.id, userPositions.positionId))
      .where(eq(acquaintances.batchId, batch.id))
      .orderBy(asc(acquaintances.createdAt));

    return {
      id: batch.id,
      documentId: batch.documentId,
      releaseAt: batch.releaseAt?.toISOString() ?? null,
      releasedAt: batch.releasedAt?.toISOString() ?? null,
      releasedReason: batch.releasedReason,
      createdByName,
      createdAt: batch.createdAt.toISOString(),
      readers: rows.map((r) => ({
        userId: r.userId,
        userName: r.userName ?? null,
        position: r.position ?? null,
        status: r.status,
        acknowledgedAt: r.acknowledgedAt?.toISOString() ?? null,
      })),
      canAcknowledge: rows.some((r) => r.userId === actor.id && r.status === 'pending'),
    };
  }

  /** Documents distributed within the period, for the acknowledgement report. */
  async reportRows(
    from: Date,
    to: Date,
    orgUnitIds: readonly string[] | undefined,
  ): Promise<
    {
      doc: typeof documents.$inferSelect;
      userName: string | null;
      orgUnitName: string | null;
      status: (typeof acquaintances.$inferSelect)['status'];
      acknowledgedAt: Date | null;
    }[]
  > {
    const where = [
      eq(acquaintanceBatches.kind, 'distribution'),
      sql`${acquaintanceBatches.createdAt} >= ${from}`,
      sql`${acquaintanceBatches.createdAt} <= ${to}`,
      isNull(documents.deletedAt),
    ];
    if (orgUnitIds) where.push(inArray(positions.orgUnitId, [...orgUnitIds]));
    const rows = await this.db
      .select({
        doc: documents,
        userName: users.shortName,
        orgUnitName: orgUnits.name,
        status: acquaintances.status,
        acknowledgedAt: acquaintances.acknowledgedAt,
      })
      .from(acquaintances)
      .innerJoin(acquaintanceBatches, eq(acquaintanceBatches.id, acquaintances.batchId))
      .innerJoin(documents, eq(documents.id, acquaintances.documentId))
      .leftJoin(users, eq(users.id, acquaintances.userId))
      .leftJoin(
        userPositions,
        and(eq(userPositions.userId, acquaintances.userId), eq(userPositions.isPrimary, true)),
      )
      .leftJoin(positions, eq(positions.id, userPositions.positionId))
      .leftJoin(orgUnits, eq(orgUnits.id, positions.orgUnitId))
      .where(and(...where))
      .orderBy(desc(acquaintanceBatches.createdAt), asc(users.shortName));
    return rows;
  }
}
