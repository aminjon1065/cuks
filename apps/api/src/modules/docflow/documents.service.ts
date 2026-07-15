import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import {
  correspondents,
  documentFiles,
  documents,
  fsNodes,
  journals,
  orgUnits,
  users,
  type Database,
} from '@cuks/db';
import {
  documentTransitionAllowed,
  type AddDocumentFileInput,
  type ChangeDocumentStatusInput,
  type CreateDocumentInput,
  type DocumentDetailDto,
  type DocumentFileDto,
  type DocumentListItemDto,
  type DocumentStatus,
  type ListDocumentsQuery,
  type PaginatedResult,
  type RegisterDocumentInput,
  type UpdateDocumentInput,
} from '@cuks/shared';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthUser } from '../../common/auth/auth-user';
import { AppException } from '../../common/exceptions/app.exception';
import { DB } from '../../common/db/db.module';
import { DocflowNumberingService } from './docflow-numbering.service';

/** Permissions that let a user see the whole (non-ДСП) registry, not just their own. */
const REGISTRY_PERMISSIONS = ['docflow.register', 'docflow.control'];

export interface DocumentStatusChangePlan {
  status: DocumentStatus;
  reason: string | null;
}

/** Pure lifecycle policy (docs/modules/11 §4) — used by the status command and tests. */
export function planDocumentStatusChange(
  current: DocumentStatus,
  input: ChangeDocumentStatusInput,
): DocumentStatusChangePlan {
  if (current === input.status) {
    throw AppException.conflict(
      'docflow.document.status_unchanged',
      'Document already has this status',
    );
  }
  if (!documentTransitionAllowed(current, input.status)) {
    throw AppException.unprocessable(
      'docflow.document.invalid_transition',
      'That status transition is not allowed',
      { fromStatus: current, toStatus: input.status },
    );
  }
  // A rollback to the author (rejected/recalled) must carry a reason (audited).
  if ((input.status === 'rejected' || input.status === 'recalled') && !input.reason?.trim()) {
    throw AppException.unprocessable(
      'docflow.document.reason_required',
      'A reason is required to reject or recall a document',
    );
  }
  return { status: input.status, reason: input.reason?.trim() || null };
}

/** Documents: the card, its files, registration and lifecycle (docs/modules/11 §3/§4). */
@Injectable()
export class DocumentsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly numbering: DocflowNumberingService,
  ) {}

  async create(input: CreateDocumentInput, actor: AuthUser): Promise<DocumentDetailDto> {
    const [created] = await this.db
      .insert(documents)
      .values({
        docClass: input.docClass,
        typeCode: input.typeCode,
        subject: input.subject,
        summary: input.summary ?? null,
        orgUnitId: input.orgUnitId ?? null,
        authorId: actor.id,
        confidentiality: input.confidentiality,
        accessList: input.accessList ?? [],
        dueDate: input.dueDate ? new Date(input.dueDate) : null,
        caseIndex: input.caseIndex ?? null,
        correspondentId: input.correspondentId ?? null,
        outgoingNumber: input.outgoingNumber ?? null,
        outgoingDate: input.outgoingDate ? new Date(input.outgoingDate) : null,
        delivery: input.delivery ?? null,
        createdBy: actor.id,
      })
      .returning({ id: documents.id });
    if (!created) throw new Error('Document insert did not return an id');
    this.audit.log({
      action: 'docflow.document.created',
      actorId: actor.id,
      entityType: 'document',
      entityId: created.id,
      meta: { docClass: input.docClass, confidentiality: input.confidentiality },
    });
    return this.detail(created.id, actor);
  }

  async list(
    query: ListDocumentsQuery,
    user: AuthUser,
  ): Promise<PaginatedResult<DocumentListItemDto>> {
    const where = and(...this.whereFor(query, user));
    const offset = (query.page - 1) * query.limit;
    const [rows, totalRows] = await Promise.all([
      this.db
        .select({
          id: documents.id,
          regNumber: documents.regNumber,
          docClass: documents.docClass,
          typeCode: documents.typeCode,
          subject: documents.subject,
          status: documents.status,
          confidentiality: documents.confidentiality,
          journalName: journals.name,
          authorName: users.shortName,
          correspondentName: correspondents.name,
          dueDate: documents.dueDate,
          regDate: documents.regDate,
          createdAt: documents.createdAt,
        })
        .from(documents)
        .leftJoin(journals, eq(journals.id, documents.journalId))
        .leftJoin(users, eq(users.id, documents.authorId))
        .leftJoin(correspondents, eq(correspondents.id, documents.correspondentId))
        .where(where)
        .orderBy(desc(documents.createdAt))
        .limit(query.limit)
        .offset(offset),
      this.db
        .select({ total: sql<number>`count(*)::int` })
        .from(documents)
        .where(where),
    ]);
    return {
      items: rows.map((r) => ({
        ...r,
        journalName: r.journalName ?? null,
        authorName: r.authorName ?? null,
        correspondentName: r.correspondentName ?? null,
        dueDate: r.dueDate?.toISOString() ?? null,
        regDate: r.regDate?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
      })),
      total: totalRows[0]?.total ?? 0,
      page: query.page,
      limit: query.limit,
    };
  }

  async detail(id: string, user: AuthUser): Promise<DocumentDetailDto> {
    const [row] = await this.db
      .select()
      .from(documents)
      .where(and(eq(documents.id, id), isNull(documents.deletedAt)))
      .limit(1);
    // Out-of-scope / ДСП-without-access is indistinguishable from missing (no leak).
    if (!row || !this.canView(row, user)) {
      throw AppException.notFound('docflow.document.not_found', 'Document not found');
    }
    const [journalRow, orgUnitRow, authorRow, correspondentRow, files] = await Promise.all([
      row.journalId
        ? this.db
            .select({ name: journals.name })
            .from(journals)
            .where(eq(journals.id, row.journalId))
            .limit(1)
        : Promise.resolve([]),
      row.orgUnitId
        ? this.db
            .select({ name: orgUnits.name })
            .from(orgUnits)
            .where(eq(orgUnits.id, row.orgUnitId))
            .limit(1)
        : Promise.resolve([]),
      this.db
        .select({ shortName: users.shortName })
        .from(users)
        .where(eq(users.id, row.authorId))
        .limit(1),
      row.correspondentId
        ? this.db
            .select({ name: correspondents.name })
            .from(correspondents)
            .where(eq(correspondents.id, row.correspondentId))
            .limit(1)
        : Promise.resolve([]),
      this.listFiles(id),
    ]);
    return {
      id: row.id,
      regNumber: row.regNumber,
      docClass: row.docClass,
      typeCode: row.typeCode,
      subject: row.subject,
      status: row.status,
      confidentiality: row.confidentiality,
      journalName: journalRow[0]?.name ?? null,
      authorName: authorRow[0]?.shortName ?? null,
      correspondentName: correspondentRow[0]?.name ?? null,
      dueDate: row.dueDate?.toISOString() ?? null,
      regDate: row.regDate?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      summary: row.summary,
      orgUnitId: row.orgUnitId,
      orgUnitName: orgUnitRow[0]?.name ?? null,
      journalId: row.journalId,
      authorId: row.authorId,
      accessList: row.accessList,
      caseIndex: row.caseIndex,
      correspondentId: row.correspondentId,
      outgoingNumber: row.outgoingNumber,
      outgoingDate: row.outgoingDate?.toISOString() ?? null,
      delivery: row.delivery,
      files,
      canEdit: row.authorId === user.id && (row.status === 'draft' || row.status === 'rejected'),
      canRegister:
        this.hasRegistryAccess(user) &&
        (row.status === 'draft' || row.status === 'pending_registration'),
    };
  }

  async update(
    id: string,
    input: UpdateDocumentInput,
    actor: AuthUser,
  ): Promise<DocumentDetailDto> {
    const row = await this.requireOwnedDraft(id, actor);
    await this.db
      .update(documents)
      .set({
        ...(input.typeCode !== undefined ? { typeCode: input.typeCode } : {}),
        ...(input.subject !== undefined ? { subject: input.subject } : {}),
        ...(input.summary !== undefined ? { summary: input.summary ?? null } : {}),
        ...(input.orgUnitId !== undefined ? { orgUnitId: input.orgUnitId ?? null } : {}),
        ...(input.confidentiality !== undefined ? { confidentiality: input.confidentiality } : {}),
        ...(input.accessList !== undefined ? { accessList: input.accessList } : {}),
        ...(input.dueDate !== undefined
          ? { dueDate: input.dueDate ? new Date(input.dueDate) : null }
          : {}),
        ...(input.caseIndex !== undefined ? { caseIndex: input.caseIndex ?? null } : {}),
        ...(input.correspondentId !== undefined
          ? { correspondentId: input.correspondentId ?? null }
          : {}),
        ...(input.outgoingNumber !== undefined
          ? { outgoingNumber: input.outgoingNumber ?? null }
          : {}),
        ...(input.outgoingDate !== undefined
          ? { outgoingDate: input.outgoingDate ? new Date(input.outgoingDate) : null }
          : {}),
        ...(input.delivery !== undefined ? { delivery: input.delivery ?? null } : {}),
      })
      .where(eq(documents.id, row.id));
    this.audit.log({
      action: 'docflow.document.updated',
      actorId: actor.id,
      entityType: 'document',
      entityId: id,
    });
    return this.detail(id, actor);
  }

  /** Register the document: assign a journal and mint its number (wires task 3.1). */
  async register(
    id: string,
    input: RegisterDocumentInput,
    actor: AuthUser,
  ): Promise<DocumentDetailDto> {
    if (!this.hasRegistryAccess(actor)) {
      throw AppException.forbidden(
        'docflow.document.register_forbidden',
        'Registration requires chancellery rights',
      );
    }
    await this.db.transaction(async (tx) => {
      const [doc] = await tx
        .select()
        .from(documents)
        .where(and(eq(documents.id, id), isNull(documents.deletedAt)))
        .limit(1)
        .for('update');
      if (!doc) throw AppException.notFound('docflow.document.not_found', 'Document not found');
      if (doc.status !== 'draft' && doc.status !== 'pending_registration') {
        throw AppException.conflict(
          'docflow.document.not_registrable',
          'Document cannot be registered in its current status',
        );
      }
      const [journal] = await tx
        .select()
        .from(journals)
        .where(and(eq(journals.id, input.journalId), isNull(journals.deletedAt)))
        .limit(1);
      if (!journal) throw AppException.notFound('docflow.journal.not_found', 'Journal not found');
      const now = new Date();
      const { number } = await this.numbering.allocate(tx, journal, now);
      await tx
        .update(documents)
        .set({
          journalId: journal.id,
          regNumber: number,
          regDate: now,
          status: 'registered',
          ...(input.caseIndex !== undefined ? { caseIndex: input.caseIndex ?? null } : {}),
        })
        .where(eq(documents.id, id));
    });
    await this.audit.logAndWait({
      action: 'docflow.document.registered',
      actorId: actor.id,
      entityType: 'document',
      entityId: id,
      meta: { journalId: input.journalId },
    });
    return this.detail(id, actor);
  }

  async changeStatus(
    id: string,
    input: ChangeDocumentStatusInput,
    actor: AuthUser,
  ): Promise<DocumentDetailDto> {
    const plan = await this.db.transaction(async (tx) => {
      const [doc] = await tx
        .select()
        .from(documents)
        .where(and(eq(documents.id, id), isNull(documents.deletedAt)))
        .limit(1)
        .for('update');
      if (!doc || !this.canView(doc, actor)) {
        throw AppException.notFound('docflow.document.not_found', 'Document not found');
      }
      // The author or the chancellery/control drives the lifecycle manually; route- and
      // resolution-driven transitions arrive with tasks 3.3/3.4.
      if (doc.authorId !== actor.id && !this.hasRegistryAccess(actor)) {
        throw AppException.forbidden(
          'docflow.document.status_forbidden',
          'You may not change this document status',
        );
      }
      const p = planDocumentStatusChange(doc.status, input);
      await tx.update(documents).set({ status: p.status }).where(eq(documents.id, id));
      return { from: doc.status, ...p };
    });
    await this.audit.logAndWait({
      action: 'docflow.document.status_changed',
      actorId: actor.id,
      entityType: 'document',
      entityId: id,
      meta: { fromStatus: plan.from, toStatus: plan.status, reason: plan.reason },
    });
    return this.detail(id, actor);
  }

  async addFile(
    id: string,
    input: AddDocumentFileInput,
    actor: AuthUser,
  ): Promise<DocumentDetailDto> {
    await this.requireOwnedDraft(id, actor);
    const [node] = await this.db
      .select({ id: fsNodes.id })
      .from(fsNodes)
      .where(eq(fsNodes.id, input.fileId))
      .limit(1);
    if (!node)
      throw AppException.badRequest(
        'docflow.document.file_missing',
        'The referenced file does not exist',
      );
    await this.db.transaction(async (tx) => {
      let version = 1;
      if (input.kind === 'main') {
        // A new main body supersedes the previous current version.
        const [prev] = await tx
          .select({ version: documentFiles.version })
          .from(documentFiles)
          .where(
            and(
              eq(documentFiles.documentId, id),
              eq(documentFiles.kind, 'main'),
              eq(documentFiles.isCurrent, true),
            ),
          )
          .limit(1);
        if (prev) {
          version = prev.version + 1;
          await tx
            .update(documentFiles)
            .set({ isCurrent: false })
            .where(
              and(
                eq(documentFiles.documentId, id),
                eq(documentFiles.kind, 'main'),
                eq(documentFiles.isCurrent, true),
              ),
            );
        }
      }
      await tx.insert(documentFiles).values({
        documentId: id,
        fileId: input.fileId,
        kind: input.kind,
        version,
        title: input.title ?? null,
        isCurrent: true,
        createdBy: actor.id,
      });
    });
    this.audit.log({
      action: 'docflow.document.file_added',
      actorId: actor.id,
      entityType: 'document',
      entityId: id,
      meta: { kind: input.kind },
    });
    return this.detail(id, actor);
  }

  private async listFiles(documentId: string): Promise<DocumentFileDto[]> {
    const rows = await this.db
      .select()
      .from(documentFiles)
      .where(eq(documentFiles.documentId, documentId))
      .orderBy(documentFiles.kind, desc(documentFiles.version));
    return rows.map((r) => ({
      id: r.id,
      fileId: r.fileId,
      kind: r.kind,
      version: r.version,
      title: r.title,
      isCurrent: r.isCurrent,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  private async requireOwnedDraft(
    id: string,
    actor: AuthUser,
  ): Promise<typeof documents.$inferSelect> {
    const [row] = await this.db
      .select()
      .from(documents)
      .where(and(eq(documents.id, id), isNull(documents.deletedAt)))
      .limit(1);
    if (!row || !this.canView(row, actor)) {
      throw AppException.notFound('docflow.document.not_found', 'Document not found');
    }
    if (row.authorId !== actor.id) {
      throw AppException.forbidden(
        'docflow.document.not_author',
        'Only the author may edit this document',
      );
    }
    if (row.status !== 'draft' && row.status !== 'rejected') {
      throw AppException.conflict(
        'docflow.document.not_editable',
        'Only a draft document can be edited',
      );
    }
    return row;
  }

  private hasRegistryAccess(user: AuthUser): boolean {
    return user.isSuperadmin || user.permissions.some((p) => REGISTRY_PERMISSIONS.includes(p));
  }

  /** Visibility (docs/modules/11 §2): participants (author + access-list) always;
   *  the non-ДСП registry additionally to the chancellery/control; ДСП stays
   *  allow-list-only even for other chancelleries. Route/resolution participants and
   *  owner-unit leadership widen this in tasks 3.3/3.4/3.8. */
  private canView(doc: typeof documents.$inferSelect, user: AuthUser): boolean {
    if (user.isSuperadmin) return true;
    if (doc.authorId === user.id) return true;
    if (doc.accessList.includes(user.id)) return true;
    if (doc.confidentiality === 'dsp') return false;
    return this.hasRegistryAccess(user);
  }

  private whereFor(query: ListDocumentsQuery, user: AuthUser): SQL[] {
    const where: SQL[] = [isNull(documents.deletedAt)];
    if (query.status) where.push(eq(documents.status, query.status));
    if (query.docClass) where.push(eq(documents.docClass, query.docClass));
    if (query.journalId) where.push(eq(documents.journalId, query.journalId));
    if (query.search) {
      const text = `%${query.search}%`;
      const cond = or(ilike(documents.subject, text), ilike(documents.regNumber, text));
      if (cond) where.push(cond);
    }

    const mine = or(
      eq(documents.authorId, user.id),
      sql`${user.id}::uuid = any(${documents.accessList})`,
    );
    switch (query.queue) {
      case 'drafts':
        where.push(eq(documents.authorId, user.id));
        where.push(inArray(documents.status, ['draft', 'rejected']));
        break;
      case 'authored':
        where.push(eq(documents.authorId, user.id));
        break;
      case 'registry':
        // The chancellery/control registry: all non-ДСП docs + one's own ДСП-access.
        if (this.hasRegistryAccess(user)) {
          if (!user.isSuperadmin) {
            const registryVisible = or(eq(documents.confidentiality, 'normal'), mine);
            if (registryVisible) where.push(registryVisible);
          }
        } else if (mine) {
          where.push(mine); // no registry rights → fall back to own involvement
        }
        break;
      default: // 'mine'
        if (mine) where.push(mine);
        break;
    }
    return where;
  }
}
