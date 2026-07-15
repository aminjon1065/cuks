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
} from 'drizzle-orm/pg-core';
import {
  DOC_CLASSES,
  DOCUMENT_CONFIDENTIALITY,
  DOCUMENT_DELIVERY,
  DOCUMENT_FILE_KINDS,
  DOCUMENT_STATUSES,
  JOURNAL_SEQ_RESETS,
  ROUTE_ASSIGNEE_TYPES,
  ROUTE_STATUSES,
  ROUTE_STEP_DECISIONS,
  ROUTE_STEP_KINDS,
  ROUTE_STEP_MODES,
  ROUTE_STEP_STATUSES,
} from '@cuks/shared';
import { appSchema, createdAt, deletedAt, primaryId, updatedAt } from './_shared';
import { fsNodes } from './fs';
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
    index('documents_status_idx').on(t.status),
    index('documents_author_idx').on(t.authorId),
    index('documents_org_unit_idx').on(t.orgUnitId),
    index('documents_journal_idx').on(t.journalId),
    index('documents_search_idx').using('gin', t.searchTsv),
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
    actedAt: timestamp('acted_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index('route_steps_route_idx').on(t.routeId, t.stepOrder),
    // The "my queue" lookup: active steps by assignee identity.
    index('route_steps_assignee_idx').on(t.status, t.assigneeType, t.assigneeId),
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
