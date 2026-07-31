import { Inject, Injectable } from '@nestjs/common';
import {
  aliasedTable,
  and,
  asc,
  desc,
  eq,
  ilike,
  inArray,
  isNull,
  ne,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import {
  acquaintances,
  auditLog,
  correspondents,
  dictionaries,
  documentCollaborators,
  documentFiles,
  documents,
  fileVersions,
  fsNodes,
  journals,
  orgUnits,
  resolutionProposals,
  resolutions,
  routeSteps,
  routes,
  signatures,
  users,
  type Database,
} from '@cuks/db';
import {
  DOCUMENT_EDITING_ROLES,
  DOCUMENT_STATUS_TRANSITIONS,
  documentContentText,
  documentTransitionAllowed,
  type AddDocumentFileInput,
  type DocumentContent,
  type ChangeDocumentStatusInput,
  type CreateDocumentInput,
  type DocumentAccessDto,
  type DocumentCollaboratorDto,
  type DocumentDetailDto,
  type DocumentFileDto,
  type DocumentHistoryEntryDto,
  type DocumentListItemDto,
  type DocumentQueueCountsDto,
  type DocumentStatus,
  type DocumentTimelineEntryDto,
  type ListDocumentsQuery,
  type PaginatedResult,
  type DocClass,
  type ReadLogEntryDto,
  type RegisterDocumentInput,
  type RegisterIncomingInput,
  type SetDocumentAccessInput,
  type UpdateDocumentInput,
} from '@cuks/shared';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthUser } from '../../common/auth/auth-user';
import { AppException } from '../../common/exceptions/app.exception';
import { DB } from '../../common/db/db.module';
import { adoptDocumentFile } from './docflow-files.service';
import { DocflowNumberingService } from './docflow-numbering.service';
import {
  collaboratorRolesOf,
  documentAvailableActions,
  isEditableStatus,
} from './document-actions';
import {
  canManageDocumentAccess,
  canViewDocumentBase,
  hasConfidentialAccess,
  hasRegistryAccess,
} from './document-visibility';
import { ReadLogService } from './read-log.service';
import { RoutesService } from './routes.service';
import { ResolutionsService } from './resolutions.service';
import { AcknowledgementsService } from './acknowledgements.service';

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

/** What is still open on a document, as counted by the status command. */
export interface DocumentObligations {
  /** Route steps still `active` on an active route. */
  activeRouteSteps: number;
  /** Resolutions still `active` (an unexecuted instruction). */
  activeResolutions: number;
  /** Assigned readers who have not acknowledged yet. */
  pendingAcquaintances: number;
}

/** Statuses that assert the document's work is finished, so nothing may still be open. */
const CLOSING_STATUSES: readonly DocumentStatus[] = ['completed', 'archived'];

/**
 * Refuse to declare a document finished while it still owes work (docs/modules/11 §4,
 * plan этап 1D §4.6). Without this, «Завершён» could be set straight past a pending
 * approval, an unexecuted instruction or an unread order — and the card would then show a
 * closed document with live obligations underneath it. Pure, so every combination is
 * unit-tested; the caller supplies the counts it read in the same locked transaction.
 */
export function assertNoOpenObligations(target: DocumentStatus, open: DocumentObligations): void {
  if (!CLOSING_STATUSES.includes(target)) return;
  if (open.activeRouteSteps > 0) {
    throw AppException.unprocessable(
      'docflow.document.route_open',
      'The document still has an active route step',
      { toStatus: target, activeRouteSteps: open.activeRouteSteps },
    );
  }
  if (open.activeResolutions > 0) {
    throw AppException.unprocessable(
      'docflow.document.resolution_open',
      'The document still has an unexecuted resolution',
      { toStatus: target, activeResolutions: open.activeResolutions },
    );
  }
  if (open.pendingAcquaintances > 0) {
    throw AppException.unprocessable(
      'docflow.document.acquaintance_open',
      'Not everyone assigned has acknowledged the document yet',
      { toStatus: target, pendingAcquaintances: open.pendingAcquaintances },
    );
  }
}

/**
 * Metadata keys the timeline may show. An allow-list rather than a redaction list: audit
 * meta is written by many call sites, and a new one must not be able to surface a document
 * body, a file key or somebody's contact on a screen by simply existing (docs/09 §5).
 */
const TIMELINE_META_KEYS = [
  'regNumber',
  'journalId',
  'fromStatus',
  'toStatus',
  'reason',
  'kind',
  'role',
  'steps',
  'stepId',
  'fileCount',
  'changedFields',
  'confidentiality',
  'mode',
] as const;

function pickTimelineMeta(meta: unknown): Record<string, string | number | boolean> | null {
  if (!meta || typeof meta !== 'object') return null;
  const source = meta as Record<string, unknown>;
  const out: Record<string, string | number | boolean> = {};
  for (const key of TIMELINE_META_KEYS) {
    const value = source[key];
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      out[key] = value;
    } else if (Array.isArray(value)) {
      // `changedFields` is a list of field NAMES — safe, and the only array we surface.
      out[key] = value.filter((v): v is string => typeof v === 'string').join(', ');
    }
  }
  return Object.keys(out).length ? out : null;
}

/** True for a Postgres unique-violation error (SQLSTATE 23505). */
function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && err.code === '23505';
}

/** The journal fields the incoming-registration policy needs. */
export interface IncomingJournalCheck {
  docClass: DocClass;
  isActive: boolean;
}

/**
 * Pure precondition policy for the atomic incoming registration (docs/modules/11 §12.2)
 * — the chancellery may only mint a number from an existing, active, incoming book.
 * Throws; used by the command and its tests.
 */
export function assertIncomingJournal(journal: IncomingJournalCheck | undefined): void {
  assertJournalForClass(journal, 'incoming');
}

/**
 * The same three checks for any class (plan этап 6). A book is not interchangeable: an
 * outgoing answer registered in «Входящие» would be handed a `ВХ-…` number and would then
 * be cited under it forever, and a closed book must not keep issuing numbers.
 */
export function assertJournalForClass(
  journal: IncomingJournalCheck | undefined,
  docClass: DocClass,
): void {
  if (!journal) throw AppException.notFound('docflow.journal.not_found', 'Journal not found');
  if (!journal.isActive) {
    throw AppException.unprocessable(
      'docflow.journal.inactive',
      'The journal is closed for registration',
    );
  }
  if (journal.docClass !== docClass) {
    throw AppException.unprocessable(
      'docflow.journal.class_mismatch',
      'The journal belongs to a different document class',
      { journalClass: journal.docClass, docClass },
    );
  }
}

/** What the registration policy needs to know about a document's signature requirement. */
export interface SignatureRequirement {
  /** True when the document's type declares that CUKS signs it before it is registered. */
  typeRequiresSignature: boolean;
  docClass: DocClass;
  /** Whether a `sign` signature exists over the document's CURRENT main version. */
  hasCurrentSignature: boolean;
}

/**
 * Registration is the moment a document becomes ours officially, so a type that must be
 * signed must already be signed (docs/modules/11 §12.1/§12.4, plan этапы 6–7).
 *
 * Applies to the documents CUKS ISSUES — outgoing and internal (a приказ is signed before it
 * is numbered). Never to an incoming letter or a citizen's appeal: those carry the sender's
 * signature on paper, and demanding ours would block the chancellery from registering the
 * post. Which types demand it is configuration, not code: the `requiresSignature` flag on the
 * `doc_type` dictionary entry. The signature must cover the CURRENT body — one over a
 * superseded version proves nothing about what is being registered.
 */
export function assertSignatureBeforeRegistration(check: SignatureRequirement): void {
  if (!check.typeRequiresSignature) return;
  if (check.docClass !== 'outgoing' && check.docClass !== 'internal') return;
  if (check.hasCurrentSignature) return;
  throw AppException.unprocessable(
    'docflow.document.signature_required',
    'This document type must be signed before it is registered',
    { docClass: check.docClass },
  );
}

/** Documents: the card, its files, registration and lifecycle (docs/modules/11 §3/§4). */
@Injectable()
export class DocumentsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly numbering: DocflowNumberingService,
    private readonly routes: RoutesService,
    private readonly resolutions: ResolutionsService,
    private readonly acknowledgements: AcknowledgementsService,
    private readonly readLog: ReadLogService,
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
        senderName: input.senderName ?? null,
        senderContact: input.senderContact ?? null,
        recipientName: input.recipientName ?? null,
        recipientContact: input.recipientContact ?? null,
        responseDueAt: input.responseDueAt ? new Date(input.responseDueAt) : null,
        // The body arrives already validated against the allow-list (the DTO); the text
        // mirror is derived here so search can never drift from what is stored.
        contentJson: input.content ?? null,
        contentText: input.content ? documentContentText(input.content) : null,
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

  /**
   * Create *and* register an incoming document in one transaction (docs/modules/11 §12.2,
   * plan этап 1B). The card, the minted number, the file links and the audit entry commit
   * together: a failure at any step leaves no orphan draft behind and burns no number
   * (the counter increment rolls back with the rest).
   *
   * Idempotent on `idempotencyKey` — a retry after a network error that dropped the
   * response, or a double-submitted form, returns the original document and number. The
   * partial unique index on `registration_key` decides the race between two simultaneous
   * replays; the loser reads the winner's result instead of minting a second number.
   */
  async registerIncoming(
    input: RegisterIncomingInput,
    actor: AuthUser,
  ): Promise<DocumentDetailDto> {
    if (!hasRegistryAccess(actor)) {
      throw AppException.forbidden(
        'docflow.document.register_forbidden',
        'Registration requires chancellery rights',
      );
    }
    const replayed = await this.findByRegistrationKey(input.idempotencyKey, actor);
    if (replayed) return this.detail(replayed, actor);

    // A missing file is the caller's mistake, not a rollback — check before opening the tx.
    await this.assertFilesExist(input.files.map((f) => f.fileId));

    let documentId: string;
    try {
      documentId = await this.db.transaction(async (tx) => {
        const [journal] = await tx
          .select()
          .from(journals)
          .where(and(eq(journals.id, input.journalId), isNull(journals.deletedAt)))
          .limit(1);
        assertIncomingJournal(journal);
        if (!journal) throw new Error('unreachable: assertIncomingJournal guarantees a journal');
        const now = new Date();
        const { number } = await this.numbering.allocate(tx, journal, now);
        const [created] = await tx
          .insert(documents)
          .values({
            journalId: journal.id,
            regNumber: number,
            regDate: now,
            status: 'registered',
            docClass: 'incoming',
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
            // The party snapshot as written on the paper: the answer's addressee is taken
            // from here, so the chancellery records it at registration (plan этап 6)
            // rather than the preparer re-typing the sender from the scan later.
            senderName: input.senderName ?? null,
            senderContact: input.senderContact ?? null,
            recipientName: input.recipientName ?? null,
            recipientContact: input.recipientContact ?? null,
            responseDueAt: input.responseDueAt ? new Date(input.responseDueAt) : null,
            registrationKey: input.idempotencyKey,
            createdBy: actor.id,
          })
          .returning({ id: documents.id });
        if (!created) throw new Error('Document insert did not return an id');
        if (input.files.length > 0) {
          // Adopt before linking: the bodies of a registered document belong to the
          // institution, not to the clerk's personal space (docs/modules/11 §12.2).
          for (const f of input.files) await adoptDocumentFile(tx, f.fileId, created.id);
          await tx.insert(documentFiles).values(
            input.files.map((f) => ({
              documentId: created.id,
              fileId: f.fileId,
              kind: f.kind,
              version: 1,
              title: f.title ?? null,
              isCurrent: true,
              createdBy: actor.id,
            })),
          );
        }
        // One entry, not created+registered: the two would share this transaction's
        // timestamp and the history tab orders by it, so the pair would read arbitrarily.
        await this.audit.logWithin(tx, {
          action: 'docflow.document.registered',
          actorId: actor.id,
          entityType: 'document',
          entityId: created.id,
          meta: {
            journalId: journal.id,
            regNumber: number,
            atomic: true,
            fileCount: input.files.length,
            confidentiality: input.confidentiality,
          },
        });
        return created.id;
      });
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      // A simultaneous replay of the same key committed first — return its result rather
      // than a 500. Any other unique violation (a duplicate number) is a real fault.
      const winner = await this.findByRegistrationKey(input.idempotencyKey, actor);
      if (!winner) throw err;
      return this.detail(winner, actor);
    }
    return this.detail(documentId, actor);
  }

  /** The document a previous run of this command produced, if the key was already used. */
  private async findByRegistrationKey(key: string, actor: AuthUser): Promise<string | null> {
    const [row] = await this.db
      .select({ id: documents.id, createdBy: documents.createdBy })
      .from(documents)
      .where(and(eq(documents.registrationKey, key), isNull(documents.deletedAt)))
      .limit(1);
    if (!row) return null;
    if (row.createdBy !== actor.id) {
      // Someone else's key: replaying it would disclose their document. Never reuse.
      throw AppException.conflict(
        'docflow.document.idempotency_conflict',
        'This idempotency key belongs to another registration',
      );
    }
    return row.id;
  }

  /**
   * Whether this user has been asked to decide a proposal on the document. Not narrowed to
   * `pending`: having decided is lasting participation, exactly as it is for a route step
   * assignee who already acted — a signer whose view vanished the instant they pressed
   * «вернуть» could not read their own decision.
   */
  private async isProposalSigner(documentId: string, userId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: resolutionProposals.id })
      .from(resolutionProposals)
      .where(
        and(
          eq(resolutionProposals.documentId, documentId),
          eq(resolutionProposals.signerId, userId),
          isNull(resolutionProposals.deletedAt),
        ),
      )
      .limit(1);
    return !!row;
  }

  /**
   * Whether the document type declares that CUKS signs it before registration
   * (plan этап 6). Kept in `dictionaries.meta` of the `doc_type` entry rather than in a new
   * typed table: `type_code` already resolves against that dictionary, and a second source
   * of truth for the same list is how the two drift apart. An unknown or unflagged type
   * requires nothing — the flag opts a type IN, so adding a type never silently blocks the
   * chancellery.
   */
  private async typeRequiresSignature(tx: Database, typeCode: string): Promise<boolean> {
    const [row] = await tx
      .select({ meta: dictionaries.meta })
      .from(dictionaries)
      .where(and(eq(dictionaries.type, 'doc_type'), eq(dictionaries.code, typeCode)))
      .limit(1);
    const meta = row?.meta;
    if (!meta || typeof meta !== 'object') return false;
    return (meta as Record<string, unknown>).requiresSignature === true;
  }

  /**
   * Is there a `sign` signature over the document's CURRENT main version? A signature over a
   * superseded body proves nothing about the text being registered, and `document_files`
   * keeps the superseded rows, so the join must go through `is_current`.
   */
  private async hasCurrentMainSignature(tx: Database, documentId: string): Promise<boolean> {
    const [row] = await tx
      .select({ id: signatures.id })
      .from(signatures)
      .innerJoin(
        documentFiles,
        and(
          eq(documentFiles.documentId, signatures.documentId),
          eq(documentFiles.kind, 'main'),
          eq(documentFiles.isCurrent, true),
        ),
      )
      .innerJoin(
        fsNodes,
        and(
          eq(fsNodes.id, documentFiles.fileId),
          eq(fsNodes.currentVersionId, signatures.docVersionId),
        ),
      )
      .where(and(eq(signatures.documentId, documentId), eq(signatures.context, 'sign')))
      .limit(1);
    return !!row;
  }

  /** The obligation counts, for a sibling service acting inside its own transaction
   *  (the dispatch completion policy, plan этап 6). */
  openObligationsFor(tx: Database, documentId: string): Promise<DocumentObligations> {
    return this.openObligations(tx, documentId);
  }

  /** Count what the document still owes: active route steps, live resolutions, unread
   *  acquaintances (plan этап 1D). Read inside the caller's locked transaction. */
  private async openObligations(tx: Database, documentId: string): Promise<DocumentObligations> {
    const [steps] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(routeSteps)
      .innerJoin(routes, eq(routes.id, routeSteps.routeId))
      .where(
        and(
          eq(routes.documentId, documentId),
          eq(routes.status, 'active'),
          eq(routeSteps.status, 'active'),
        ),
      );
    const [resolutionRows] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(resolutions)
      .where(and(eq(resolutions.documentId, documentId), eq(resolutions.status, 'active')));
    // By STATUS, not by the timestamp: a line the gate released as `expired` never gets an
    // `acknowledged_at` and can never be closed by anyone, so counting it as outstanding
    // would refuse «Завершён» and «В архив» on that document forever (plan этап 7 review).
    // The document still owes nothing — the sheet closed, the silence is on the record.
    const [acquaintanceRows] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(acquaintances)
      .where(and(eq(acquaintances.documentId, documentId), eq(acquaintances.status, 'pending')));
    return {
      activeRouteSteps: steps?.n ?? 0,
      activeResolutions: resolutionRows?.n ?? 0,
      pendingAcquaintances: acquaintanceRows?.n ?? 0,
    };
  }

  /** Every referenced fs node must exist (deleted/unknown ids are a 400, not a rollback). */
  private async assertFilesExist(fileIds: string[]): Promise<void> {
    if (fileIds.length === 0) return;
    const unique = [...new Set(fileIds)];
    const rows = await this.db
      .select({ id: fsNodes.id })
      .from(fsNodes)
      .where(and(inArray(fsNodes.id, unique), isNull(fsNodes.deletedAt)));
    if (rows.length !== unique.length) {
      throw AppException.badRequest(
        'docflow.document.file_missing',
        'The referenced file does not exist',
      );
    }
  }

  async list(
    query: ListDocumentsQuery,
    user: AuthUser,
  ): Promise<PaginatedResult<DocumentListItemDto>> {
    // Action queues resolve to route steps: keep a doc→step map so each row can carry the
    // step to act on directly. «Мои поручения» resolves to document ids only.
    let queueDocIds: string[] | undefined;
    let actionSteps: Map<string, { stepId: string; onBehalfOf: string | null }> | undefined;
    let onBehalfNames: Map<string, string | null> | undefined;
    if (
      query.queue === 'to_approve' ||
      query.queue === 'to_sign' ||
      query.queue === 'to_acknowledge'
    ) {
      const steps =
        query.queue === 'to_approve'
          ? await this.routes.approvalQueueSteps(user.id)
          : query.queue === 'to_sign'
            ? await this.routes.signQueueSteps(user.id)
            : await this.acknowledgements.toAcknowledgeSteps(user.id);
      actionSteps = new Map(
        steps.map((s) => {
          // Acknowledge steps have no substitution «за» today; approve/sign carry onBehalfOf.
          const onBehalfOf = (s as { onBehalfOf?: string | null }).onBehalfOf ?? null;
          return [s.documentId, { stepId: s.stepId, onBehalfOf }] as const;
        }),
      );
      // The step map is only for the ROW ACTION. The id set comes from the queue's own
      // source, which for acknowledgement also includes batch-driven lines (a distribution
      // has no route step, and building the list from the step join hid it entirely —
      // plan этап 7 review). Those rows simply carry no inline action: the card is where
      // such a sheet is signed.
      queueDocIds =
        query.queue === 'to_acknowledge'
          ? await this.acknowledgements.toAcknowledgeDocumentIds(user.id)
          : [...actionSteps.keys()];
      onBehalfNames = await this.userShortNames(
        [...actionSteps.values()].map((v) => v.onBehalfOf).filter((v): v is string => !!v),
      );
    } else if (query.queue === 'my_tasks') {
      queueDocIds = await this.resolutions.myTasksDocumentIds(user.id);
    }
    const where = and(...this.whereFor(query, user, queueDocIds));
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
        actionStepId: actionSteps?.get(r.id)?.stepId ?? null,
        actionOnBehalfOfName: (() => {
          const p = actionSteps?.get(r.id)?.onBehalfOf;
          return p ? (onBehalfNames?.get(p) ?? null) : null;
        })(),
      })),
      total: totalRows[0]?.total ?? 0,
      page: query.page,
      limit: query.limit,
    };
  }

  /** Pending-work counts for the cabinet queue badges (docs/modules/11 §7). */
  async queueCounts(user: AuthUser): Promise<DocumentQueueCountsDto> {
    const [approve, sign, ack, tasks] = await Promise.all([
      this.routes.approvalQueueDocumentIds(user.id),
      this.routes.signQueueDocumentIds(user.id),
      this.acknowledgements.toAcknowledgeDocumentIds(user.id),
      this.resolutions.myTasksDocumentIds(user.id),
    ]);
    return {
      to_approve: approve.length,
      to_sign: sign.length,
      to_acknowledge: ack.length,
      my_tasks: tasks.length,
    };
  }

  /** A document's audit history — the «История» tab (docs/modules/11 §7). Visibility-gated
   *  (only a document the caller can see); pinned to `entityType='document'`. */
  async history(id: string, user: AuthUser): Promise<DocumentHistoryEntryDto[]> {
    await this.assertVisible(id, user); // visibility gate only — never a logged «open»
    const rows = await this.db
      .select({
        id: auditLog.id,
        action: auditLog.action,
        actorName: users.shortName,
        createdAt: auditLog.createdAt,
      })
      .from(auditLog)
      .leftJoin(users, eq(users.id, auditLog.actorId))
      .where(and(eq(auditLog.entityType, 'document'), eq(auditLog.entityId, id)))
      .orderBy(desc(auditLog.createdAt))
      .limit(200);
    return rows.map((r) => ({
      id: r.id,
      action: r.action,
      actorName: r.actorName ?? null,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  /** Load a document the caller may view, or throw 404 (out-of-scope / ДСП-without-access
   *  is indistinguishable from missing — no existence leak). Author + access_list see it via
   *  the base rule; for NON-ДСП documents route/resolution/acknowledge participants also may.
   *  ДСП is strict — допуск-список ∩ право only (docs/09 §3): participation never substitutes,
   *  so it stays consistent with the queues (whereFor hides a ДСП task from a non-listed
   *  executor) and the notification redaction (no click-through to the subject). */
  async assertVisible(id: string, user: AuthUser): Promise<typeof documents.$inferSelect> {
    const [row] = await this.db
      .select()
      .from(documents)
      .where(and(eq(documents.id, id), isNull(documents.deletedAt)))
      .limit(1);
    if (!row) throw AppException.notFound('docflow.document.not_found', 'Document not found');
    if (!canViewDocumentBase(row, user)) {
      if (row.confidentiality === 'dsp') {
        throw AppException.notFound('docflow.document.not_found', 'Document not found');
      }
      const participant =
        (await this.routes.isRouteParticipantActing(id, user.id)) ||
        (await this.resolutions.isResolutionParticipant(id, user.id)) ||
        (await this.acknowledgements.isAcquaintance(id, user.id)) ||
        // An assigned collaborator is a participant: without this the role is inert —
        // a preparer could be given a document they cannot open (plan этап 2). Reached
        // only for NON-ДСП documents; the ДСП branch above already returned.
        (await collaboratorRolesOf(this.db, id, user.id)).length > 0 ||
        // So is the signer of a proposal awaiting their decision: being asked to approve a
        // document you cannot open is not a workflow (plan этап 5).
        (await this.isProposalSigner(id, user.id));
      if (!participant) {
        throw AppException.notFound('docflow.document.not_found', 'Document not found');
      }
    }
    return row;
  }

  async detail(id: string, user: AuthUser): Promise<DocumentDetailDto> {
    const row = await this.assertVisible(id, user);
    // ДСП access trail (docs/09 §3): log every open by someone other than the author.
    if (row.confidentiality === 'dsp' && row.authorId !== user.id) {
      this.readLog.record('document', id);
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
    const [collaborators, roles] = await Promise.all([
      this.listCollaborators(id),
      collaboratorRolesOf(this.db, id, user.id),
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
      // Row actions come from the queue list; the card drives actions via its sections.
      actionStepId: null,
      actionOnBehalfOfName: null,
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
      senderName: row.senderName,
      senderContact: row.senderContact,
      recipientName: row.recipientName,
      recipientContact: row.recipientContact,
      responseDueAt: row.responseDueAt?.toISOString() ?? null,
      content: (row.contentJson ?? null) as DocumentContent | null,
      templateVersionId: row.templateVersionId,
      version: row.version,
      files,
      collaborators,
      // One server-side answer for the whole action bar (docs/modules/11 §12.5); a manual
      // status change additionally needs the graph to offer one.
      availableActions: documentAvailableActions(row, user, roles).filter(
        (a) => a !== 'changeStatus' || DOCUMENT_STATUS_TRANSITIONS[row.status].length > 0,
      ),
    };
  }

  /** The document's unified timeline (docs/modules/11 §12.5): every audited business event
   *  on the card, newest first, with the actor resolved and only whitelisted metadata. */
  async timeline(id: string, user: AuthUser): Promise<DocumentTimelineEntryDto[]> {
    await this.assertVisible(id, user); // gate only — reading the timeline is not an «open»
    const rows = await this.db
      .select({
        id: auditLog.id,
        action: auditLog.action,
        actorName: users.shortName,
        createdAt: auditLog.createdAt,
        meta: auditLog.meta,
      })
      .from(auditLog)
      .leftJoin(users, eq(users.id, auditLog.actorId))
      .where(and(eq(auditLog.entityType, 'document'), eq(auditLog.entityId, id)))
      .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
      .limit(200);
    return rows.map((r) => ({
      id: r.id,
      action: r.action,
      actorName: r.actorName ?? null,
      at: r.createdAt.toISOString(),
      meta: pickTimelineMeta(r.meta),
    }));
  }

  /**
   * Edit an editable draft (docs/modules/11 §12.5). The author or a `preparer`/`editor`
   * collaborator may; the write is guarded by `expectedVersion`, so two editors on the same
   * card cannot silently overwrite each other — the second one is told to reload.
   *
   * Access management stays out of this path even though the fields exist on the create
   * schema: a collaborator must never widen a ДСП allow-list, and the author has a
   * dedicated audited endpoint for the grif (`PATCH :id/access`).
   */
  async update(
    id: string,
    input: UpdateDocumentInput,
    actor: AuthUser,
  ): Promise<DocumentDetailDto> {
    const row = await this.requireEditable(id, actor);
    const patch = {
      ...(input.typeCode !== undefined ? { typeCode: input.typeCode } : {}),
      ...(input.subject !== undefined ? { subject: input.subject } : {}),
      ...(input.summary !== undefined ? { summary: input.summary ?? null } : {}),
      ...(input.orgUnitId !== undefined ? { orgUnitId: input.orgUnitId ?? null } : {}),
      ...(input.dueDate !== undefined
        ? { dueDate: input.dueDate ? new Date(input.dueDate) : null }
        : {}),
      ...(input.responseDueAt !== undefined
        ? { responseDueAt: input.responseDueAt ? new Date(input.responseDueAt) : null }
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
      ...(input.senderName !== undefined ? { senderName: input.senderName ?? null } : {}),
      ...(input.senderContact !== undefined ? { senderContact: input.senderContact ?? null } : {}),
      ...(input.recipientName !== undefined ? { recipientName: input.recipientName ?? null } : {}),
      ...(input.recipientContact !== undefined
        ? { recipientContact: input.recipientContact ?? null }
        : {}),
      ...(input.content !== undefined
        ? {
            contentJson: input.content ?? null,
            contentText: input.content ? documentContentText(input.content) : null,
          }
        : {}),
    };
    const changedFields = Object.keys(patch);
    if (changedFields.length === 0) return this.detail(id, actor);

    const [updated] = await this.db
      .update(documents)
      .set({ ...patch, version: sql`${documents.version} + 1` })
      // The version predicate IS the concurrency check: no row matches once someone else
      // has saved, and no read-then-write window exists to lose an edit in.
      .where(and(eq(documents.id, row.id), eq(documents.version, input.expectedVersion)))
      .returning({ version: documents.version });
    if (!updated) {
      throw AppException.conflict(
        'docflow.document.version_conflict',
        'The document changed since it was loaded — reload before saving',
        { expectedVersion: input.expectedVersion, actualVersion: row.version },
      );
    }
    await this.audit.logAndWait({
      action: 'docflow.document.updated',
      actorId: actor.id,
      entityType: 'document',
      entityId: id,
      // Field NAMES only — never the values, which can be the document's own content.
      meta: { changedFields, version: updated.version },
    });
    return this.detail(id, actor);
  }

  /** Register the document: assign a journal and mint its number (wires task 3.1). */
  async register(
    id: string,
    input: RegisterDocumentInput,
    actor: AuthUser,
  ): Promise<DocumentDetailDto> {
    if (!hasRegistryAccess(actor)) {
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
      if (!doc || !canViewDocumentBase(doc, actor)) {
        // ДСП isolation applies to the write side too: a chancellery not on the
        // allow-list must not register a document it cannot even see.
        throw AppException.notFound('docflow.document.not_found', 'Document not found');
      }
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
      assertJournalForClass(journal, doc.docClass);
      if (!journal) throw AppException.notFound('docflow.journal.not_found', 'Journal not found');
      assertSignatureBeforeRegistration({
        typeRequiresSignature: await this.typeRequiresSignature(tx, doc.typeCode),
        docClass: doc.docClass,
        hasCurrentSignature: await this.hasCurrentMainSignature(tx, id),
      });
      const now = new Date();
      const { number } = await this.numbering.allocate(tx, journal, now);
      // Registration IS the completion path of a `register` route step (plan этап 1D):
      // close it first, then write the final status — otherwise the route completing would
      // leave the document at `pending_registration` on top of the number just minted.
      await this.routes.completeRegisterStep(tx, id, actor.id, now);
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
      if (!doc || !canViewDocumentBase(doc, actor)) {
        throw AppException.notFound('docflow.document.not_found', 'Document not found');
      }
      // The author or the chancellery/control drives the lifecycle manually; route- and
      // resolution-driven transitions arrive with tasks 3.3/3.4.
      if (doc.authorId !== actor.id && !hasRegistryAccess(actor)) {
        throw AppException.forbidden(
          'docflow.document.status_forbidden',
          'You may not change this document status',
        );
      }
      const p = planDocumentStatusChange(doc.status, input);
      // Read the obligations under the same row lock that gates the transition, so a step
      // or resolution cannot slip in between the check and the write.
      assertNoOpenObligations(p.status, await this.openObligations(tx, id));
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
    // A preparer attaches the body they were asked to prepare — same gate as editing.
    await this.requireEditable(id, actor);
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
      // Lock the document so concurrent main uploads serialise — otherwise two would
      // both insert an is_current main row and collide on document_files_current_main_uq.
      await tx
        .select({ id: documents.id })
        .from(documents)
        .where(eq(documents.id, id))
        .limit(1)
        .for('update');
      let version = 1;
      if (input.kind === 'main') {
        // A signed main body is frozen: a new version would strand its signatures on the
        // superseded version. Block it (the signatures are a legal record) — docs/modules/11
        // §3, docs/09-security.md §4.
        const [signed] = await tx
          .select({ id: signatures.id })
          .from(signatures)
          .where(eq(signatures.documentId, id))
          .limit(1);
        if (signed) {
          throw AppException.conflict(
            'docflow.document.signed_frozen',
            'The document is signed; its main file can no longer be replaced',
          );
        }
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
      // Same adoption as the atomic registration: the node leaves the uploader's
      // personal space so only the document policy can reach it (docs/modules/11 §12.2).
      await adoptDocumentFile(tx, input.fileId, id);
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

  /** The card's file rows, joined to the fs node so the UI shows a real name, size and
   *  antivirus state instead of a bare uuid (plan этап 1C). */
  private async listFiles(documentId: string): Promise<DocumentFileDto[]> {
    const rows = await this.db
      .select({
        id: documentFiles.id,
        fileId: documentFiles.fileId,
        kind: documentFiles.kind,
        version: documentFiles.version,
        title: documentFiles.title,
        isCurrent: documentFiles.isCurrent,
        createdAt: documentFiles.createdAt,
        name: fsNodes.name,
        mime: fsNodes.mime,
        size: fsNodes.sizeCached,
        avStatus: fileVersions.avStatus,
      })
      .from(documentFiles)
      .leftJoin(fsNodes, eq(fsNodes.id, documentFiles.fileId))
      .leftJoin(fileVersions, eq(fileVersions.id, fsNodes.currentVersionId))
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
      name: r.name ?? r.fileId,
      mime: r.mime,
      size: r.size ?? 0,
      avStatus: r.avStatus,
    }));
  }

  /**
   * Load a document this caller may edit, or throw (docs/modules/11 §12.5). The author and
   * a `preparer`/`editor` collaborator both qualify — that is what the role is for — but
   * only while the status still allows edits. The status check comes AFTER the permission
   * check so a stranger learns nothing about the document's state.
   */
  private async requireEditable(
    id: string,
    actor: AuthUser,
  ): Promise<typeof documents.$inferSelect> {
    // The same visibility gate as the card, so a collaborator — who is visible only via
    // the async participant check — is not turned away with a 404 before their role is
    // even looked at.
    const row = await this.assertVisible(id, actor);
    const roles = await collaboratorRolesOf(this.db, id, actor.id);
    const isOwner = row.authorId === actor.id || actor.isSuperadmin;
    if (!isOwner && !roles.some((r) => DOCUMENT_EDITING_ROLES.includes(r))) {
      throw AppException.forbidden(
        'docflow.document.not_author',
        'Only the author or an assigned editor may edit this document',
      );
    }
    if (!isEditableStatus(row.status)) {
      throw AppException.conflict(
        'docflow.document.not_editable',
        'Only an editable draft can be changed',
        { status: row.status },
      );
    }
    return row;
  }

  /** The card's collaborator list — kept here so `detail()` renders it in one round-trip. */
  private async listCollaborators(documentId: string): Promise<DocumentCollaboratorDto[]> {
    const assigner = aliasedTable(users, 'doc_collaborator_assigner');
    const holder = aliasedTable(users, 'doc_collaborator_user');
    const rows = await this.db
      .select({
        id: documentCollaborators.id,
        userId: documentCollaborators.userId,
        userName: holder.shortName,
        role: documentCollaborators.role,
        assignedByName: assigner.shortName,
        createdAt: documentCollaborators.createdAt,
      })
      .from(documentCollaborators)
      .leftJoin(holder, eq(holder.id, documentCollaborators.userId))
      .leftJoin(assigner, eq(assigner.id, documentCollaborators.assignedBy))
      .where(
        and(
          eq(documentCollaborators.documentId, documentId),
          isNull(documentCollaborators.deletedAt),
        ),
      )
      .orderBy(asc(documentCollaborators.createdAt));
    return rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      userName: r.userName ?? null,
      role: r.role,
      assignedByName: r.assignedByName ?? null,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  /** Load a document the caller may MANAGE, or 404 (no existence leak). */
  private async loadManageable(id: string, user: AuthUser): Promise<typeof documents.$inferSelect> {
    const [row] = await this.db
      .select()
      .from(documents)
      .where(and(eq(documents.id, id), isNull(documents.deletedAt)))
      .limit(1);
    if (!row || !canManageDocumentAccess(row, user)) {
      throw AppException.notFound('docflow.document.not_found', 'Document not found');
    }
    return row;
  }

  /** The document's confidentiality + resolved access-list members (the «Доступ» section). Gated
   *  on view-eligibility (assertVisible) — a viewer sees the grif read-only, a non-viewer gets
   *  404 (never a spurious error); `canManage` tells the caller whether they may edit. */
  async getAccess(id: string, user: AuthUser): Promise<DocumentAccessDto> {
    const row = await this.assertVisible(id, user);
    return this.accessDto(row, user);
  }

  /** Set the grif + allow-list (docs/09 §3) — a manager (author / view-eligible confidential.view
   *  holder); audited. */
  async setAccess(
    id: string,
    input: SetDocumentAccessInput,
    user: AuthUser,
  ): Promise<DocumentAccessDto> {
    const row = await this.loadManageable(id, user);
    const accessList = [...new Set(input.accessList)];
    await this.db
      .update(documents)
      .set({ confidentiality: input.confidentiality, accessList, updatedAt: new Date() })
      .where(eq(documents.id, id));
    this.audit.log({
      action: 'docflow.document.access_changed',
      entityType: 'document',
      entityId: id,
      meta: { confidentiality: input.confidentiality, members: accessList.length },
    });
    return this.accessDto({ ...row, confidentiality: input.confidentiality, accessList }, user);
  }

  /** The ДСП access trail for a document — a manager only (who accessed the restricted document). */
  async readLogFor(id: string, user: AuthUser): Promise<ReadLogEntryDto[]> {
    await this.loadManageable(id, user);
    return this.readLog.listForDocument(id);
  }

  private async accessDto(
    row: Pick<typeof documents.$inferSelect, 'authorId' | 'confidentiality' | 'accessList'>,
    user: AuthUser,
  ): Promise<DocumentAccessDto> {
    const members = row.accessList.length
      ? await this.db
          .select({ userId: users.id, name: users.shortName })
          .from(users)
          .where(inArray(users.id, row.accessList))
      : [];
    return {
      confidentiality: row.confidentiality,
      members: members.map((m) => ({ userId: m.userId, name: m.name ?? null })),
      canManage: canManageDocumentAccess(row, user),
    };
  }

  /** Resolve a set of user ids to their short names (for the queue «за кого» chip). */
  private async userShortNames(ids: string[]): Promise<Map<string, string | null>> {
    const unique = [...new Set(ids)];
    if (!unique.length) return new Map();
    const rows = await this.db
      .select({ id: users.id, name: users.shortName })
      .from(users)
      .where(inArray(users.id, unique));
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  private whereFor(query: ListDocumentsQuery, user: AuthUser, queueDocIds?: string[]): SQL[] {
    const where: SQL[] = [isNull(documents.deletedAt)];
    if (query.status) where.push(eq(documents.status, query.status));
    if (query.docClass) where.push(eq(documents.docClass, query.docClass));
    if (query.journalId) where.push(eq(documents.journalId, query.journalId));
    // The journals register view filters by registration year (docs/modules/11 §7).
    if (query.year) {
      where.push(sql`extract(year from ${documents.regDate}) = ${query.year}`);
    }
    if (query.search) {
      const text = `%${query.search}%`;
      const cond = or(ilike(documents.subject, text), ilike(documents.regNumber, text));
      if (cond) where.push(cond);
    }

    const onAccessList = sql`${user.id}::uuid = any(${documents.accessList})`;
    // A live collaborator grant is involvement too — otherwise an assigned preparer could
    // not even find the document they were asked to prepare (plan этап 2). ДСП is not
    // widened by it: the guard below still admits only the author and the allow-list.
    const isCollaborator = sql`exists (
      select 1 from ${documentCollaborators} dc
      where dc.document_id = ${documents.id}
        and dc.user_id = ${user.id}::uuid
        and dc.deleted_at is null
    )`;
    // A proposal's signer must be able to FIND the document they were asked to decide on,
    // not only open it by link (plan этап 5).
    const isPendingSigner = sql`exists (
      select 1 from ${resolutionProposals} rp
      where rp.document_id = ${documents.id}
        and rp.signer_id = ${user.id}::uuid
        and rp.deleted_at is null
    )`;
    const mine = or(eq(documents.authorId, user.id), onAccessList, isCollaborator, isPendingSigner);

    // ДСП guard (docs/09-security.md §3): a ДСП document surfaces in ANY list/search only to its
    // author, or — when the caller holds docflow.confidential.view — to access-list members. This
    // keeps ДСП out of search for the non-допущенные regardless of the queue below.
    if (!user.isSuperadmin) {
      const notDsp = ne(documents.confidentiality, 'dsp');
      const dspVisible = hasConfidentialAccess(user)
        ? or(notDsp, eq(documents.authorId, user.id), onAccessList)
        : or(notDsp, eq(documents.authorId, user.id));
      if (dspVisible) where.push(dspVisible);
    }

    switch (query.queue) {
      case 'drafts':
        where.push(eq(documents.authorId, user.id));
        where.push(inArray(documents.status, ['draft', 'rejected']));
        break;
      case 'authored':
        where.push(eq(documents.authorId, user.id));
        break;
      case 'to_approve':
      case 'to_sign':
      case 'to_acknowledge':
      case 'my_tasks':
        // Documents the caller has an active approve/sign/acknowledge step, or an active
        // resolution to execute (my_tasks). An empty id set yields `false` (no rows).
        where.push(inArray(documents.id, queueDocIds ?? []));
        break;
      case 'registry':
        // The chancellery/control registry: all non-ДСП docs + one's own ДСП-access.
        if (hasRegistryAccess(user)) {
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
