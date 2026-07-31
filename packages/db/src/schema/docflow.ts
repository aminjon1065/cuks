import { sql } from 'drizzle-orm';
import {
  boolean,
  customType,
  index,
  integer,
  jsonb,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import {
  ACQUAINTANCE_BATCH_KINDS,
  ACQUAINTANCE_RELEASE_REASONS,
  ACQUAINTANCE_STATUSES,
  CERTIFICATE_KINDS,
  DOC_CLASSES,
  DOCUMENT_COLLABORATOR_ROLES,
  DOCUMENT_CONFIDENTIALITY,
  DOCUMENT_DELIVERY,
  DOCUMENT_FILE_KINDS,
  DOCUMENT_LINK_KINDS,
  DOCUMENT_STATUSES,
  JOURNAL_SEQ_RESETS,
  RESOLUTION_ACTION_KINDS,
  RESOLUTION_PROPOSAL_STATUSES,
  RESOLUTION_STATUSES,
  ROUTE_ASSIGNEE_TYPES,
  ROUTE_STATUSES,
  ROUTE_STEP_DECISIONS,
  ROUTE_STEP_KINDS,
  ROUTE_STEP_MODES,
  ROUTE_STEP_STATUSES,
  SIGNATURE_ALGORITHMS,
  SIGNATURE_CONTEXTS,
} from '@cuks/shared';
import { appSchema, createdAt, deletedAt, primaryId, updatedAt } from './_shared';
import { fileVersions, fsNodes } from './fs';
import { orgUnits } from './org';
import { users } from './users';

/** FTS vector (docs/07 §Поиск, config `russian`); generated, GIN-indexed. */
const tsvector = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'tsvector';
  },
});

/**
 * app.journals — registration books (docs/modules/11 §1/§3). Each carries its own
 * numbering (`number_template`, e.g. `{П}-{YYYY}/{seq4}`) reset per `seq_reset`.
 * A journal may belong to an org unit (department books) or be global (null).
 * Reference data managed by the chancellery (`docflow.journals.manage`); soft-deleted.
 */
export const journals = appSchema.table(
  'journals',
  {
    id: primaryId(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    docClass: text('doc_class', { enum: DOC_CLASSES }).notNull(),
    numberTemplate: text('number_template').notNull(),
    seqReset: text('seq_reset', { enum: JOURNAL_SEQ_RESETS }).notNull().default('yearly'),
    orgUnitId: uuid('org_unit_id').references(() => orgUnits.id, { onDelete: 'restrict' }),
    sort: integer('sort').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [
    // Code is unique among live journals; a soft-deleted one frees its code for reuse.
    uniqueIndex('journals_code_uq')
      .on(t.code)
      .where(sql`${t.deletedAt} is null`),
    index('journals_doc_class_idx').on(t.docClass, t.isActive),
  ],
);

/**
 * app.journal_counters — the gap-free registration counter (docs/modules/11 §3).
 * One row per (journal, year); `last_seq` is incremented under a transaction-scoped
 * advisory lock so concurrent registrations never collide or skip a number. A
 * composition of the journal (cascade on hard delete).
 */
export const journalCounters = appSchema.table(
  'journal_counters',
  {
    id: primaryId(),
    journalId: uuid('journal_id')
      .notNull()
      .references(() => journals.id, { onDelete: 'cascade' }),
    year: integer('year').notNull(),
    lastSeq: integer('last_seq').notNull().default(0),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('journal_counters_journal_year_uq').on(t.journalId, t.year)],
);

/**
 * app.correspondents — external organisations/persons for incoming/outgoing docs
 * (docs/07 §correspondents). `category_code` references the `correspondent_category`
 * dictionary. Created on the fly by the chancellery during registration; soft-deleted.
 */
export const correspondents = appSchema.table(
  'correspondents',
  {
    id: primaryId(),
    name: text('name').notNull(),
    shortName: text('short_name'),
    categoryCode: text('category_code'),
    address: text('address'),
    phones: text('phones'),
    email: text('email'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    // FTS over name + short name for the registration-wizard search (docs/07 §Поиск).
    searchTsv: tsvector('search_tsv').generatedAlwaysAs(
      sql`to_tsvector('russian', "name" || ' ' || coalesce("short_name", ''))`,
    ),
  },
  (t) => [
    index('correspondents_search_idx').using('gin', t.searchTsv),
    index('correspondents_active_idx').on(t.isActive),
  ],
);

/**
 * app.nomenclature — the case-index registry (docs/modules/11 §1). Documents are
 * filed into a case (`documents.case_index`) drawn from this list. Managed by the
 * chancellery (`docflow.journals.manage`); soft-deleted.
 */
export const nomenclature = appSchema.table(
  'nomenclature',
  {
    id: primaryId(),
    index: text('index').notNull(),
    title: text('title').notNull(),
    orgUnitId: uuid('org_unit_id').references(() => orgUnits.id, { onDelete: 'restrict' }),
    retentionNote: text('retention_note'),
    sort: integer('sort').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [
    uniqueIndex('nomenclature_index_uq')
      .on(t.index)
      .where(sql`${t.deletedAt} is null`),
    index('nomenclature_active_sort_idx').on(t.isActive, t.sort),
  ],
);

/**
 * app.documents — the document card (docs/modules/11 §3). Unregistered until the
 * chancellery assigns a journal + number (reg_number/reg_date null until then). The
 * status machine (draft → … → archived, + rejected/recalled) is enforced in the
 * service via the shared transition policy. Money-free; times are timestamptz.
 * `access_list` holds the extra viewers for a ДСП (restricted) document. `case_index`
 * files the document into a nomenclature case (by value, no FK — the case list is
 * curated separately). Soft-deleted; FTS over subject + summary + reg_number.
 */
export const documents = appSchema.table(
  'documents',
  {
    id: primaryId(),
    journalId: uuid('journal_id').references(() => journals.id, { onDelete: 'restrict' }),
    regNumber: text('reg_number'),
    regDate: timestamp('reg_date', { withTimezone: true }),
    docClass: text('doc_class', { enum: DOC_CLASSES }).notNull(),
    typeCode: text('type_code').notNull(),
    subject: text('subject').notNull(),
    summary: text('summary'),
    orgUnitId: uuid('org_unit_id').references(() => orgUnits.id, { onDelete: 'restrict' }),
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    status: text('status', { enum: DOCUMENT_STATUSES }).notNull().default('draft'),
    confidentiality: text('confidentiality', { enum: DOCUMENT_CONFIDENTIALITY })
      .notNull()
      .default('normal'),
    accessList: uuid('access_list')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    dueDate: timestamp('due_date', { withTimezone: true }),
    caseIndex: text('case_index'),
    correspondentId: uuid('correspondent_id').references(() => correspondents.id, {
      onDelete: 'restrict',
    }),
    outgoingNumber: text('outgoing_number'),
    outgoingDate: timestamp('outgoing_date', { withTimezone: true }),
    delivery: text('delivery', { enum: DOCUMENT_DELIVERY }),
    /** Snapshot of the counterparty as written on the paper (docs/modules/11 §12.5). Kept
     *  alongside `correspondent_id`, never instead of it: the directory entry can be
     *  renamed or merged later, but what this letter said must not change with it. */
    senderName: text('sender_name'),
    senderContact: text('sender_contact'),
    recipientName: text('recipient_name'),
    recipientContact: text('recipient_contact'),
    /** When an answer is due to the correspondent — distinct from `due_date`, which is the
     *  internal execution deadline. */
    responseDueAt: timestamp('response_due_at', { withTimezone: true }),
    /** Optimistic-concurrency token: every accepted edit bumps it, and an edit carrying a
     *  stale value is refused instead of silently overwriting the other editor. */
    version: integer('version').notNull().default(1),
    /** Structured body (docs/modules/11 §12.7) — TipTap/ProseMirror JSON constrained to
     *  the shared allow-list, with `content_text` as its flattened mirror for search. */
    contentJson: jsonb('content_json'),
    contentText: text('content_text'),
    /** The template version this document was instantiated from, so the result stays
     *  reproducible after the template moves on. */
    templateVersionId: uuid('template_version_id'),
    /** Idempotency key of the atomic incoming-registration command that created this
     *  document (docs/modules/11 §12.2). A retried command carrying the same key returns
     *  the original document instead of minting a second number; null for documents
     *  created any other way. */
    registrationKey: uuid('registration_key'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    // FTS over subject + summary + reg_number (docs/07 §Поиск, config `russian`).
    searchTsv: tsvector('search_tsv').generatedAlwaysAs(
      sql`to_tsvector('russian', "subject" || ' ' || coalesce("summary", '') || ' ' || coalesce("reg_number", ''))`,
    ),
  },
  (t) => [
    // A registration number is unique within its journal (backstops the counter).
    uniqueIndex('documents_journal_reg_number_uq')
      .on(t.journalId, t.regNumber)
      .where(sql`${t.regNumber} is not null`),
    // The idempotency guarantee: a concurrent replay of the same registration command
    // loses the race here (23505) instead of minting a second number.
    uniqueIndex('documents_registration_key_uq')
      .on(t.registrationKey)
      .where(sql`${t.registrationKey} is not null`),
    index('documents_status_idx').on(t.status),
    index('documents_author_idx').on(t.authorId),
    index('documents_org_unit_idx').on(t.orgUnitId),
    index('documents_journal_idx').on(t.journalId),
    index('documents_search_idx').using('gin', t.searchTsv),
  ],
);

/**
 * app.document_templates — reusable document blanks (docs/modules/11 §12.7, plan §6.3).
 * The template is the stable identity; its body lives in versions, so publishing a new
 * one never rewrites documents already produced from an older one. `org_unit_id` null
 * means the template is available across the whole committee.
 */
export const documentTemplates = appSchema.table(
  'document_templates',
  {
    id: primaryId(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    docClass: text('doc_class', { enum: DOC_CLASSES }).notNull(),
    documentTypeCode: text('document_type_code'),
    orgUnitId: uuid('org_unit_id').references(() => orgUnits.id, { onDelete: 'restrict' }),
    routeTemplateId: uuid('route_template_id').references(() => routeTemplates.id, {
      onDelete: 'set null',
    }),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [
    uniqueIndex('document_templates_code_uq')
      .on(t.code)
      .where(sql`${t.deletedAt} is null`),
    index('document_templates_pick_idx').on(t.docClass, t.isActive),
  ],
);

/**
 * app.document_template_versions — one immutable draft/published body per version.
 * A published version is never edited: documents carry `template_version_id`, and letting
 * the body move underneath them would silently rewrite what was already issued.
 */
export const documentTemplateVersions = appSchema.table(
  'document_template_versions',
  {
    id: primaryId(),
    templateId: uuid('template_id')
      .notNull()
      .references(() => documentTemplates.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    contentJson: jsonb('content_json'),
    contentText: text('content_text'),
    /** Set when the version is published; null while it is still a draft. */
    publishedAt: timestamp('published_at', { withTimezone: true }),
    publishedBy: uuid('published_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [
    uniqueIndex('document_template_versions_uq').on(t.templateId, t.version),
    index('document_template_versions_template_idx').on(t.templateId),
  ],
);

/**
 * app.document_collaborators — who besides the author may work on a document
 * (docs/modules/11 §12.5, plan §6.2). The author remains the owner; a collaborator only
 * gains what its role grants and never bypasses the ДСП allow-list, access management or
 * registration. Soft-deleted so a revoked grant stays visible in the history.
 */
export const documentCollaborators = appSchema.table(
  'document_collaborators',
  {
    id: primaryId(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    role: text('role', { enum: DOCUMENT_COLLABORATOR_ROLES }).notNull(),
    assignedBy: uuid('assigned_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    // One live grant per (document, user, role) — re-granting an existing role is a no-op
    // rather than a duplicate row.
    uniqueIndex('document_collaborators_active_uq')
      .on(t.documentId, t.userId, t.role)
      .where(sql`${t.deletedAt} is null`),
    index('document_collaborators_document_idx').on(t.documentId),
    // «Documents I was invited to» — the reverse lookup the registry queue needs.
    index('document_collaborators_user_idx').on(t.userId),
  ],
);

/**
 * app.document_files — a document's files with per-kind versioning (docs/modules/11
 * §3). The `main` body is versioned (v1, v2, … with a single `is_current`); each
 * `attachment` is its own row. A new `main` version is free until the first
 * signature freezes the file (enforced once `signatures` lands in task 3.5). The
 * file itself lives in `fs_nodes` (a `system`-space node).
 */
export const documentFiles = appSchema.table(
  'document_files',
  {
    id: primaryId(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    fileId: uuid('file_id')
      .notNull()
      .references(() => fsNodes.id, { onDelete: 'restrict' }),
    kind: text('kind', { enum: DOCUMENT_FILE_KINDS }).notNull(),
    version: integer('version').notNull().default(1),
    title: text('title'),
    isCurrent: boolean('is_current').notNull().default(true),
    createdAt: createdAt(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [
    index('document_files_document_idx').on(t.documentId),
    // Exactly one current main body per document.
    uniqueIndex('document_files_current_main_uq')
      .on(t.documentId)
      .where(sql`${t.kind} = 'main' and ${t.isCurrent}`),
  ],
);

/**
 * app.routes — an approval/signing route over a document (docs/modules/11 §3/§4).
 * At most one active route per document; a rejected route is cancelled and kept as
 * history, and re-launching starts a new `cycle`. Task 3.3.
 */
export const routes = appSchema.table(
  'routes',
  {
    id: primaryId(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    cycle: integer('cycle').notNull().default(1),
    status: text('status', { enum: ROUTE_STATUSES }).notNull().default('active'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [
    index('routes_document_idx').on(t.documentId),
    // One active route per document (the engine relies on this).
    uniqueIndex('routes_one_active_uq')
      .on(t.documentId)
      .where(sql`${t.status} = 'active'`),
  ],
);

/**
 * app.route_steps — the steps of a route (docs/modules/11 §3). Steps sharing a
 * `step_order` are a parallel group; groups activate in order. `assignee_id` is
 * polymorphic (user/position/org_unit), so it has no FK (like resource_acl). The
 * previous `acted_by` records the actual actor (substitutions, task 3.11).
 */
export const routeSteps = appSchema.table(
  'route_steps',
  {
    id: primaryId(),
    routeId: uuid('route_id')
      .notNull()
      .references(() => routes.id, { onDelete: 'cascade' }),
    stepOrder: integer('step_order').notNull(),
    kind: text('kind', { enum: ROUTE_STEP_KINDS }).notNull(),
    mode: text('mode', { enum: ROUTE_STEP_MODES }).notNull().default('sequential'),
    assigneeType: text('assignee_type', { enum: ROUTE_ASSIGNEE_TYPES }).notNull(),
    assigneeId: uuid('assignee_id').notNull(),
    dueHours: integer('due_hours'),
    status: text('status', { enum: ROUTE_STEP_STATUSES }).notNull().default('pending'),
    decision: text('decision', { enum: ROUTE_STEP_DECISIONS }),
    comment: text('comment'),
    actedBy: uuid('acted_by').references(() => users.id, { onDelete: 'set null' }),
    // The principal a deputy acted «за» (task 3.11); null for a self/superadmin action. Stored
    // (not derived from acted_by ≠ assignee) so a position/org-unit step attributes precisely and
    // a superadmin override is not mislabeled.
    actedFor: uuid('acted_for').references(() => users.id, { onDelete: 'set null' }),
    actedAt: timestamp('acted_at', { withTimezone: true }),
    /** When the step became `active` — the clock its SLA runs from (docs/modules/11 §12.9).
     *  Null while the step is still waiting for its group. */
    activatedAt: timestamp('activated_at', { withTimezone: true }),
    /** `activated_at + due_hours`, materialised so the SLA sweep can find overdue steps
     *  with an index instead of recomputing the sum for every row. */
    dueAt: timestamp('due_at', { withTimezone: true }),
    /** When the step reached a terminal status — distinct from `acted_at`, which is when a
     *  person decided; a skipped step is completed without anyone acting. */
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index('route_steps_route_idx').on(t.routeId, t.stepOrder),
    // The "my queue" lookup: active steps by assignee identity.
    index('route_steps_assignee_idx').on(t.status, t.assigneeType, t.assigneeId),
    // The SLA sweep: overdue/soon-due steps, narrowed to the ones that still have a clock.
    index('route_steps_due_idx')
      .on(t.dueAt)
      .where(sql`${t.status} = 'active' and ${t.dueAt} is not null`),
  ],
);

/**
 * app.route_templates — reusable route definitions (docs/modules/11 §3), e.g.
 * «Приказ: юрист → зам → председатель». `steps` is a jsonb array of
 * {order, kind, assigneeType, assigneeId, dueHours}. Chancellery-managed; soft-deleted.
 */
export const routeTemplates = appSchema.table(
  'route_templates',
  {
    id: primaryId(),
    name: text('name').notNull(),
    orgUnitId: uuid('org_unit_id').references(() => orgUnits.id, { onDelete: 'set null' }),
    steps: jsonb('steps')
      .notNull()
      .default(sql`'[]'::jsonb`),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [index('route_templates_active_idx').on(t.isActive)],
);

/**
 * app.resolutions — a leader's instruction on a document (docs/modules/11 §3/§5).
 * The executor is responsible; co_executors assist; `is_control` + `due_date` put it
 * on the control view. Sub-resolutions nest via `parent_id`. `report`/`done_at` record
 * execution. Task 3.4.
 */
/**
 * app.resolution_types — the kinds of instruction a signer may issue (plan §6.4). A typed
 * dictionary rather than a free-text label, because the type decides what the executor
 * owes: whether a deadline is required, whether an outgoing answer is expected, whether it
 * lands under control. Retired by `is_active`, never deleted — issued resolutions must stay
 * explainable.
 */
export const resolutionTypes = appSchema.table(
  'resolution_types',
  {
    id: primaryId(),
    code: text('code').notNull(),
    nameRu: text('name_ru').notNull(),
    nameTj: text('name_tj').notNull(),
    actionKind: text('action_kind', { enum: RESOLUTION_ACTION_KINDS }).notNull().default('execute'),
    requiresDueAt: boolean('requires_due_at').notNull().default(false),
    requiresExecutor: boolean('requires_executor').notNull().default(true),
    requiresOutgoingResponse: boolean('requires_outgoing_response').notNull().default(false),
    defaultControl: boolean('default_control').notNull().default(false),
    /** ISO-8601-ish hours; null means «no default», not «immediately». */
    defaultDueHours: integer('default_due_hours'),
    isActive: boolean('is_active').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('resolution_types_code_uq').on(t.code),
    index('resolution_types_pick_idx').on(t.isActive, t.sortOrder),
  ],
);

/**
 * app.acquaintance_batches — a pre-execution reading gate (docs/modules/11 §12.3). The
 * executors of the resolution this batch guards do not see their instruction until the gate
 * opens: either everyone acknowledged, or the timeout expired.
 *
 * `released_at` is the idempotency anchor — the worker and a final acknowledgement race for
 * it, and whoever writes it first owns the release.
 */
export const acquaintanceBatches = appSchema.table(
  'acquaintance_batches',
  {
    id: primaryId(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    resolutionId: uuid('resolution_id').references((): AnyPgColumn => resolutions.id, {
      onDelete: 'cascade',
    }),
    routeStepId: uuid('route_step_id').references(() => routeSteps.id, { onDelete: 'set null' }),
    kind: text('kind', { enum: ACQUAINTANCE_BATCH_KINDS }).notNull(),
    /** When the gate opens by itself; null for a batch that gates nothing. */
    releaseAt: timestamp('release_at', { withTimezone: true }),
    releasedAt: timestamp('released_at', { withTimezone: true }),
    releasedReason: text('released_reason', { enum: ACQUAINTANCE_RELEASE_REASONS }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    index('acquaintance_batches_document_idx').on(t.documentId),
    // The worker sweep: batches whose timeout has come and which nobody has released yet.
    index('acquaintance_batches_release_idx')
      .on(t.releaseAt)
      .where(sql`${t.releasedAt} is null and ${t.releaseAt} is not null`),
  ],
);

/**
 * app.resolution_proposals — a draft resolution awaiting a signer's decision (plan §6.5).
 * Deliberately NOT a status on `resolutions`: a proposal is a request for a decision, an
 * issued resolution is an instruction being executed, and merging them would make
 * «rejected» mean two different things.
 */
export const resolutionProposals = appSchema.table(
  'resolution_proposals',
  {
    id: primaryId(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    resolutionTypeId: uuid('resolution_type_id').references(() => resolutionTypes.id, {
      onDelete: 'restrict',
    }),
    text: text('text').notNull(),
    /** The one person who may decide this proposal. */
    signerId: uuid('signer_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    responsibleExecutorId: uuid('responsible_executor_id').references(() => users.id, {
      onDelete: 'restrict',
    }),
    coExecutorIds: uuid('co_executor_ids')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    /** Who must read the document BEFORE the executors get their instruction. */
    acquaintUserIds: uuid('acquaint_user_ids')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    dueAt: timestamp('due_at', { withTimezone: true }),
    isControl: boolean('is_control').notNull().default(false),
    status: text('status', { enum: RESOLUTION_PROPOSAL_STATUSES }).notNull().default('draft'),
    proposedBy: uuid('proposed_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    decidedBy: uuid('decided_by').references(() => users.id, { onDelete: 'set null' }),
    /** The principal a deputy decided «за» (docs/05 §6); null for a self decision. */
    decidedFor: uuid('decided_for').references(() => users.id, { onDelete: 'set null' }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decisionComment: text('decision_comment'),
    /** The resolution an approval produced — the link that makes the decision auditable. */
    resolutionId: uuid('resolution_id').references((): AnyPgColumn => resolutions.id, {
      onDelete: 'set null',
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    index('resolution_proposals_document_idx').on(t.documentId),
    // The signer's queue: what is waiting for MY decision.
    index('resolution_proposals_signer_idx')
      .on(t.signerId, t.status)
      .where(sql`${t.deletedAt} is null`),
  ],
);

export const resolutions = appSchema.table(
  'resolutions',
  {
    id: primaryId(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    parentId: uuid('parent_id').references((): AnyPgColumn => resolutions.id, {
      onDelete: 'cascade',
    }),
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    executorId: uuid('executor_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    coExecutors: uuid('co_executors')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    text: text('text').notNull(),
    dueDate: timestamp('due_date', { withTimezone: true }),
    isControl: boolean('is_control').notNull().default(false),
    status: text('status', { enum: RESOLUTION_STATUSES }).notNull().default('active'),
    report: text('report'),
    doneAt: timestamp('done_at', { withTimezone: true }),
    /** When the executors may actually see this instruction (docs/modules/11 §12.3). Null
     *  means «right away»; a future value means a pre-execution reading gate is still shut.
     *  Enforced in the queue query, not only in the UI. */
    availableAt: timestamp('available_at', { withTimezone: true }),
    /** Explicit acceptance / return of the executor's result. */
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    acceptedBy: uuid('accepted_by').references(() => users.id, { onDelete: 'set null' }),
    returnedAt: timestamp('returned_at', { withTimezone: true }),
    returnComment: text('return_comment'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('resolutions_document_idx').on(t.documentId),
    index('resolutions_executor_idx').on(t.executorId, t.status),
    // «Мои поручения» skips instructions still behind a gate.
    index('resolutions_available_idx').on(t.availableAt),
    // The «Мои поручения» queue also matches co-executors (uuid[] containment).
    index('resolutions_co_executors_idx').using('gin', t.coExecutors),
  ],
);

/**
 * app.resolution_extensions — the accumulating deadline-extension log of a controlled
 * resolution (docs/modules/11 §5): who moved the old due date to the new one, and why.
 */
export const resolutionExtensions = appSchema.table(
  'resolution_extensions',
  {
    id: primaryId(),
    resolutionId: uuid('resolution_id')
      .notNull()
      .references(() => resolutions.id, { onDelete: 'cascade' }),
    oldDue: timestamp('old_due', { withTimezone: true }),
    newDue: timestamp('new_due', { withTimezone: true }).notNull(),
    reason: text('reason').notNull(),
    extendedBy: uuid('extended_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [index('resolution_extensions_resolution_idx').on(t.resolutionId)],
);

/**
 * app.certificates — a user's per-device signing certificate (docs/09-security.md §4,
 * task 3.5). The device generates an ECDSA P-256 key in the browser (private key never
 * leaves the device); the internal CA issues this certificate over the device's public
 * key. `ca_signature` binds the certificate to the CA (chain of trust). A revoked
 * certificate stays in the table so historical signatures remain verifiable. The
 * subject fields are a snapshot of the holder at issue time.
 */
export const certificates = appSchema.table(
  'certificates',
  {
    id: primaryId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    serial: text('serial').notNull(),
    kind: text('kind', { enum: CERTIFICATE_KINDS }).notNull().default('device'),
    deviceLabel: text('device_label').notNull(),
    // The device public key (SPKI, base64) the CA certified.
    publicKeySpki: text('public_key_spki').notNull(),
    // Subject snapshot: username, full name, position at issue time.
    subjectUsername: text('subject_username').notNull(),
    subjectFullName: text('subject_full_name').notNull(),
    subjectPosition: text('subject_position'),
    // The CA's ECDSA P-384 signature over the canonical certificate body (base64).
    caSignature: text('ca_signature').notNull(),
    notBefore: timestamp('not_before', { withTimezone: true }).notNull(),
    notAfter: timestamp('not_after', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedReason: text('revoked_reason'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('certificates_serial_uq').on(t.serial),
    index('certificates_user_idx').on(t.userId),
  ],
);

/**
 * app.signatures — a signature over a concrete file version + card requisites
 * (docs/09-security.md §4, task 3.5). `doc_version_id` pins the immutable
 * `file_versions` row that was signed (so the exact bytes are known forever). `payload`
 * is the canonical string that was signed (buildSignPayload); `signature` is the raw
 * (IEEE P1363) ECDSA-P256-SHA256 signature, base64. `context` distinguishes a full
 * signing from a route approval or an acknowledgement. Insert-only — never updated.
 */
export const signatures = appSchema.table(
  'signatures',
  {
    id: primaryId(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    docVersionId: uuid('doc_version_id')
      .notNull()
      .references(() => fileVersions.id, { onDelete: 'restrict' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    // The person signed FOR, when a deputy signs «за» an absent principal (task 3.11). Null for
    // an ordinary signature; the key/cert is always the actual signer's (`user_id`).
    onBehalfOf: uuid('on_behalf_of').references(() => users.id, { onDelete: 'restrict' }),
    certificateId: uuid('certificate_id')
      .notNull()
      .references(() => certificates.id, { onDelete: 'restrict' }),
    // The route step this signature satisfied (if any), for the sign-queue / substitution.
    routeStepId: uuid('route_step_id').references(() => routeSteps.id, { onDelete: 'set null' }),
    algorithm: text('algorithm', { enum: SIGNATURE_ALGORITHMS }).notNull(),
    context: text('context', { enum: SIGNATURE_CONTEXTS }).notNull(),
    // The exact canonical payload that was signed, and its SHA-256 (hex), for the record.
    payload: text('payload').notNull(),
    payloadHash: text('payload_hash').notNull(),
    signature: text('signature').notNull(),
    signedAt: timestamp('signed_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [
    index('signatures_document_idx').on(t.documentId),
    index('signatures_doc_version_idx').on(t.docVersionId),
    index('signatures_user_idx').on(t.userId),
  ],
);

/**
 * app.acquaintances — a document's acknowledgement sheet (docs/modules/11 §3/§6, task
 * 3.6). An `acknowledge` route step assigned to a subdivision expands into one row per
 * member; each employee acknowledges (a lightweight recorded read, `acknowledged_at`).
 * `route_step_id` ties the row to the step that generated it, so the step completes once
 * every row is acknowledged and «На ознакомление» can list pending rows.
 */
export const acquaintances = appSchema.table(
  'acquaintances',
  {
    id: primaryId(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    routeStepId: uuid('route_step_id').references(() => routeSteps.id, { onDelete: 'set null' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
    /** The gate this line belongs to (docs/modules/11 §12.11); null for a plain route
     *  acknowledgement that gates nothing. */
    batchId: uuid('batch_id').references((): AnyPgColumn => acquaintanceBatches.id, {
      onDelete: 'cascade',
    }),
    /** `expired` records that the gate opened without this reader — NOT that they read it
     *  (docs/modules/11 §12.3). Conflating the two would let a timeout be reported as
     *  compliance. */
    status: text('status', { enum: ACQUAINTANCE_STATUSES }).notNull().default('pending'),
    notifiedAt: timestamp('notified_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    // One acknowledgement line per user per generating step (idempotent expansion).
    uniqueIndex('acquaintances_step_user_uq').on(t.routeStepId, t.userId),
    index('acquaintances_document_idx').on(t.documentId),
    // The «На ознакомление» queue: the user's pending lines.
    index('acquaintances_user_pending_idx').on(t.userId, t.acknowledgedAt),
  ],
);

/**
 * app.document_links — relations between documents (docs/modules/11 §3, task 3.7): a
 * generic association or a reply (`src` answers `dst`). Shown bidirectionally on both
 * cards (the query unions src=id and dst=id). One row per directed pair; the service
 * rejects self-links and existing links in either direction.
 */
export const documentLinks = appSchema.table(
  'document_links',
  {
    id: primaryId(),
    srcDocumentId: uuid('src_document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    dstDocumentId: uuid('dst_document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: DOCUMENT_LINK_KINDS }).notNull().default('related'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('document_links_pair_uq').on(t.srcDocumentId, t.dstDocumentId),
    index('document_links_src_idx').on(t.srcDocumentId),
    index('document_links_dst_idx').on(t.dstDocumentId),
  ],
);
