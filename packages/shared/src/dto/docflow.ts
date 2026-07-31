import { z } from 'zod';
import { documentContentSchema, type DocumentContent } from '../docflow/content';
import {
  DOC_CLASSES,
  DOCUMENT_CONFIDENTIALITY,
  DOCUMENT_DELIVERY,
  DISPATCH_CHANNELS,
  DISTRIBUTION_TARGET_TYPES,
  DOCUMENT_FILE_KINDS,
  DOCUMENT_LINK_KINDS,
  DOCUMENT_STATUSES,
  JOURNAL_SEQ_RESETS,
  ROUTE_ASSIGNEE_TYPES,
  DOCUMENT_COLLABORATOR_ROLES,
  ROUTE_STEP_KINDS,
  type AcquaintanceReleaseReason,
  type AcquaintanceStatus,
  type AvStatus,
  type ControlSeverity,
  type DocumentAction,
  type DocumentCollaboratorRole,
  type DocumentLinkKind,
  type DocClass,
  type DocumentConfidentiality,
  type DocumentDelivery,
  type DocumentFileKind,
  type DispatchChannel,
  type DispatchStatus,
  type DispositionBatchStatus,
  type DispositionItemDecision,
  type DispositionStatus,
  type DocumentStatus,
  type JournalSeqReset,
  RESOLUTION_ACTION_KINDS,
  type ResolutionActionKind,
  type ResolutionProposalStatus,
  type ResolutionStatus,
  type RouteAssigneeType,
  type RouteStatus,
  type RouteStepDecision,
  type RouteStepKind,
  type RouteStepStatus,
  type SignatureAlgorithm,
  type SignatureContext,
} from '../enums/index';

// --- Journals (docs/modules/11 §1/§3) ---

/** A registration-number template: literal text plus `{YYYY}`/`{YY}` (year),
 *  `{MM}` (month) and a mandatory `{seqN}` zero-padded sequence token. Any other
 *  `{X}` is emitted literally as `X` (so `{П}` → `П`). */
const numberTemplateSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/\{seq\d+\}/, 'The template must contain a {seqN} sequence token');

const journalCodeSchema = z
  .string()
  .min(1)
  .max(32)
  .regex(/^[a-z0-9_-]+$/i, 'The code may contain only letters, digits, "-" and "_"');

export const createJournalSchema = z.object({
  code: journalCodeSchema,
  name: z.string().min(1).max(200),
  docClass: z.enum(DOC_CLASSES),
  numberTemplate: numberTemplateSchema,
  seqReset: z.enum(JOURNAL_SEQ_RESETS).default('yearly'),
  orgUnitId: z.string().uuid().nullish(),
  sort: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
});
export type CreateJournalInput = z.infer<typeof createJournalSchema>;

/** Code is immutable after creation (it identifies the book). */
export const updateJournalSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  docClass: z.enum(DOC_CLASSES).optional(),
  numberTemplate: numberTemplateSchema.optional(),
  seqReset: z.enum(JOURNAL_SEQ_RESETS).optional(),
  orgUnitId: z.string().uuid().nullish(),
  sort: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
});
export type UpdateJournalInput = z.infer<typeof updateJournalSchema>;

export interface JournalDto {
  id: string;
  code: string;
  name: string;
  docClass: DocClass;
  numberTemplate: string;
  seqReset: JournalSeqReset;
  orgUnitId: string | null;
  orgUnitName: string | null;
  sort: number;
  isActive: boolean;
}

// --- Correspondents (docs/07 §correspondents; docs/modules/11) ---

export const createCorrespondentSchema = z.object({
  name: z.string().min(1).max(300),
  shortName: z.string().max(100).nullish(),
  categoryCode: z.string().max(64).nullish(),
  address: z.string().max(500).nullish(),
  phones: z.string().max(200).nullish(),
  // Contact fields carry varied formats (informal notes, several numbers), so email
  // is length-bounded but not format-validated — see docs/plan/STATUS.md decisions.
  email: z.string().max(200).nullish(),
  isActive: z.boolean().optional(),
});
export type CreateCorrespondentInput = z.infer<typeof createCorrespondentSchema>;

export const updateCorrespondentSchema = createCorrespondentSchema.partial();
export type UpdateCorrespondentInput = z.infer<typeof updateCorrespondentSchema>;

export const correspondentsQuerySchema = z.object({
  search: z.string().max(200).optional(),
  // Query strings only — avoid z.coerce.boolean (which turns "false" into true).
  activeOnly: z.preprocess(
    (v) => (v === undefined ? undefined : v === 'true' || v === true),
    z.boolean().optional(),
  ),
});
export type CorrespondentsQuery = z.infer<typeof correspondentsQuerySchema>;

export interface CorrespondentDto {
  id: string;
  name: string;
  shortName: string | null;
  categoryCode: string | null;
  address: string | null;
  phones: string | null;
  email: string | null;
  isActive: boolean;
}

// --- Nomenclature / case index (docs/modules/11 §1) ---

export const createNomenclatureSchema = z.object({
  index: z.string().min(1).max(32),
  title: z.string().min(1).max(300),
  orgUnitId: z.string().uuid().nullish(),
  retentionNote: z.string().max(200).nullish(),
  /** The term in months, snapshotted onto every document filed here (plan §6.9). */
  retentionMonths: z.number().int().min(1).max(1200).nullish(),
  isPermanent: z.boolean().default(false),
  archiveOrgUnitId: z.string().uuid().nullish(),
  dispositionRequiresApproval: z.boolean().default(true),
  sort: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
});
export type CreateNomenclatureInput = z.infer<typeof createNomenclatureSchema>;

/** Index is immutable after creation (it identifies the case). */
export const updateNomenclatureSchema = z.object({
  title: z.string().min(1).max(300).optional(),
  orgUnitId: z.string().uuid().nullish(),
  retentionNote: z.string().max(200).nullish(),
  retentionMonths: z.number().int().min(1).max(1200).nullish(),
  isPermanent: z.boolean().optional(),
  archiveOrgUnitId: z.string().uuid().nullish(),
  dispositionRequiresApproval: z.boolean().optional(),
  sort: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
});
export type UpdateNomenclatureInput = z.infer<typeof updateNomenclatureSchema>;

export interface NomenclatureDto {
  id: string;
  index: string;
  title: string;
  orgUnitId: string | null;
  orgUnitName: string | null;
  retentionNote: string | null;
  retentionMonths: number | null;
  isPermanent: boolean;
  archiveOrgUnitId: string | null;
  dispositionRequiresApproval: boolean;
  sort: number;
  isActive: boolean;
}

// --- Dictionary-backed options (read-only) ---

/** A document type (backed by the `doc_type` dictionary). */
export interface DocumentTypeDto {
  code: string;
  nameRu: string;
  nameTg: string;
}

/** A correspondent category (backed by the `correspondent_category` dictionary). */
export interface CorrespondentCategoryDto {
  code: string;
  nameRu: string;
  nameTg: string;
}

// --- Routes (docs/modules/11 §3/§4, task 3.3) ---

/** One step of a route or template. Steps sharing an `order` are a parallel group. */
export const routeStepInputSchema = z.object({
  order: z.number().int().min(0).max(100),
  kind: z.enum(ROUTE_STEP_KINDS),
  assigneeType: z.enum(ROUTE_ASSIGNEE_TYPES),
  assigneeId: z.string().uuid(),
  dueHours: z.number().int().min(1).max(8760).nullish(),
});
export type RouteStepInput = z.infer<typeof routeStepInputSchema>;

/** Start a route from a template or an explicit step list (exactly one). */
export const startRouteSchema = z
  .object({
    templateId: z.string().uuid().optional(),
    steps: z.array(routeStepInputSchema).min(1).max(50).optional(),
  })
  .refine((v) => (v.templateId ? !v.steps : !!v.steps), {
    message: 'Provide either a templateId or a steps list, not both',
  });
export type StartRouteInput = z.infer<typeof startRouteSchema>;

/** One step's verdict from the dry-run: who it would actually reach, and what is wrong. */
export interface RouteStepValidationDto {
  order: number;
  kind: RouteStepKind;
  assigneeType: RouteAssigneeType;
  assigneeId: string;
  /** Display name of the assignee (user / position / subdivision), if it resolves. */
  assigneeName: string | null;
  /** People who would actually be able to act — a position or subdivision may expand to
   *  several, or to nobody. */
  actorNames: string[];
  /** Stable problem codes; an empty list means the step is startable. */
  problems: RouteValidationProblem[];
}

export const ROUTE_VALIDATION_PROBLEMS = [
  'no_assignee',
  'assignee_not_found',
  'action_kind_unsupported',
] as const;
export type RouteValidationProblem = (typeof ROUTE_VALIDATION_PROBLEMS)[number];

/** The dry-run result: what the route would do, without writing anything. */
export interface RouteValidationDto {
  valid: boolean;
  steps: RouteStepValidationDto[];
  /** Parallel groups, in execution order — what the builder renders as barriers. */
  groups: { order: number; stepCount: number }[];
}

export const approveRouteStepSchema = z.object({ comment: z.string().max(2000).nullish() });
export type ApproveRouteStepInput = z.infer<typeof approveRouteStepSchema>;

/** A rejection must carry a reason (docs/modules/11 §4). */
export const rejectRouteStepSchema = z.object({ comment: z.string().min(1).max(2000) });
export type RejectRouteStepInput = z.infer<typeof rejectRouteStepSchema>;

export const createRouteTemplateSchema = z.object({
  name: z.string().min(1).max(200),
  orgUnitId: z.string().uuid().nullish(),
  steps: z.array(routeStepInputSchema).min(1).max(50),
  isActive: z.boolean().optional(),
});
export type CreateRouteTemplateInput = z.infer<typeof createRouteTemplateSchema>;

export const updateRouteTemplateSchema = createRouteTemplateSchema.partial();
export type UpdateRouteTemplateInput = z.infer<typeof updateRouteTemplateSchema>;

export interface RouteStepDto {
  id: string;
  stepOrder: number;
  kind: RouteStepKind;
  assigneeType: RouteAssigneeType;
  assigneeId: string;
  assigneeName: string | null;
  status: RouteStepStatus;
  decision: RouteStepDecision | null;
  comment: string | null;
  actedByName: string | null;
  /** When acted by a deputy «за» a principal (task 3.11): who they acted for. */
  actedForName: string | null;
  actedAt: string | null;
  dueHours: number | null;
  /** SLA timestamps (docs/modules/11 §12.9): the clock starts when the step activates, so
   *  a long first step never eats a later step's budget. Null while the step waits. */
  activatedAt: string | null;
  dueAt: string | null;
  completedAt: string | null;
  /** Whether the current caller may act on this step (assignee match + active). */
  canAct: boolean;
  /** Set when the caller may act only via a substitution: the principal they would act «за». */
  actOnBehalfOfName: string | null;
}

export interface RouteDto {
  id: string;
  cycle: number;
  status: RouteStatus;
  createdByName: string | null;
  createdAt: string;
  completedAt: string | null;
  steps: RouteStepDto[];
}

export interface RouteTemplateDto {
  id: string;
  name: string;
  orgUnitId: string | null;
  orgUnitName: string | null;
  steps: RouteStepInput[];
  isActive: boolean;
}

// --- Documents (docs/modules/11 §3/§4) ---

/** Counterparty requisites as written on the paper — a snapshot beside `correspondentId`,
 *  never instead of it (docs/modules/11 §12.5). */
const partyFields = {
  senderName: z.string().max(300).nullish(),
  senderContact: z.string().max(300).nullish(),
  recipientName: z.string().max(300).nullish(),
  recipientContact: z.string().max(300).nullish(),
};

export const createDocumentSchema = z.object({
  docClass: z.enum(DOC_CLASSES),
  typeCode: z.string().min(1).max(64),
  subject: z.string().min(1).max(500),
  summary: z.string().max(5000).nullish(),
  orgUnitId: z.string().uuid().nullish(),
  confidentiality: z.enum(DOCUMENT_CONFIDENTIALITY).default('normal'),
  accessList: z.array(z.string().uuid()).max(500).optional(),
  dueDate: z.string().datetime().nullish(),
  /** When an answer is owed to the correspondent — distinct from `dueDate`, the internal
   *  execution deadline. */
  responseDueAt: z.string().datetime().nullish(),
  caseIndex: z.string().max(32).nullish(),
  correspondentId: z.string().uuid().nullish(),
  outgoingNumber: z.string().max(64).nullish(),
  outgoingDate: z.string().datetime().nullish(),
  delivery: z.enum(DOCUMENT_DELIVERY).nullish(),
  /** Structured body, validated against the allow-list on write (docs/modules/11 §12.7). */
  content: documentContentSchema.nullish(),
  ...partyFields,
});
export type CreateDocumentInput = z.infer<typeof createDocumentSchema>;

/**
 * All fields optional; only an editable draft may be edited (enforced server-side).
 * `expectedVersion` is the `version` the editor loaded: an edit carrying a stale value is
 * refused with `docflow.document.version_conflict` rather than silently overwriting
 * whatever the other editor saved in the meantime (docs/modules/11 §12.5).
 */
export const updateDocumentSchema = createDocumentSchema
  .partial()
  .omit({ docClass: true })
  .extend({ expectedVersion: z.number().int().min(1) });
export type UpdateDocumentInput = z.infer<typeof updateDocumentSchema>;

export const DOCUMENT_QUEUES = [
  'mine',
  'drafts',
  'authored',
  'registry',
  'to_approve',
  'to_sign',
  'to_acknowledge',
  'my_tasks',
] as const;
export type DocumentQueue = (typeof DOCUMENT_QUEUES)[number];

/**
 * The columns a document list may be ordered by — an ALLOW-LIST, not a hint.
 *
 * A sort parameter is a column name travelling from the client into an ORDER BY, which is the
 * classic place a register grows an injection. Naming the permitted columns here means the
 * server never has to decide whether a string is safe: anything outside this list is a 400
 * from the DTO, and the service maps the survivor through a literal table of drizzle columns
 * (plan §12.1 «search query builder allow-list»).
 *
 * `relevance` is only meaningful for a search with a query behind it; the search endpoint
 * refuses it otherwise rather than silently ordering by nothing.
 */
export const DOCUMENT_SORT_FIELDS = [
  'created_at',
  'reg_date',
  'due_date',
  'subject',
  'reg_number',
  'status',
  'relevance',
] as const;
export type DocumentSortField = (typeof DOCUMENT_SORT_FIELDS)[number];

/** `-field` is descending, `field` ascending — the convention in docs/04 §Списки. */
export const documentSortSchema = z
  .string()
  .max(40)
  .refine((v) => DOCUMENT_SORT_FIELDS.includes(v.replace(/^-/, '') as DocumentSortField), {
    message: 'Unsupported sort field',
  });

export const listDocumentsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  queue: z.enum(DOCUMENT_QUEUES).default('mine'),
  status: z.enum(DOCUMENT_STATUSES).optional(),
  docClass: z.enum(DOC_CLASSES).optional(),
  journalId: z.string().uuid().optional(),
  search: z.string().max(200).optional(),
  /** Registration year (by reg_date) — the journals register view (docs/modules/11 §7). */
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  sort: documentSortSchema.optional(),
});
export type ListDocumentsQuery = z.infer<typeof listDocumentsQuerySchema>;

// --- Full-text search (docs/modules/11 §12.13, plan §6.11/§7.8) ---

/** Where a hit came from. Reported so a result can say WHY it matched — a row whose subject
 *  contains none of the words reads as a mistake unless the list says «нашлось во вложении». */
export const SEARCH_MATCH_SOURCES = ['document', 'file', 'correspondent', 'number'] as const;
export type SearchMatchSource = (typeof SEARCH_MATCH_SOURCES)[number];

export const documentSearchQuerySchema = z.object({
  /** The query itself. Trimmed, and empty is refused: an empty search is just the register. */
  q: z.string().trim().min(1).max(200),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  docClass: z.enum(DOC_CLASSES).optional(),
  status: z.enum(DOCUMENT_STATUSES).optional(),
  journalId: z.string().uuid().optional(),
  correspondentId: z.string().uuid().optional(),
  /** Registration date range, inclusive — the boundaries are Asia/Dushanbe days. */
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  sort: documentSortSchema.optional(),
});
export type DocumentSearchQuery = z.infer<typeof documentSearchQuerySchema>;

export interface DocumentSearchHitDto {
  id: string;
  regNumber: string | null;
  subject: string;
  docClass: DocClass;
  typeCode: string;
  status: DocumentStatus;
  confidentiality: DocumentConfidentiality;
  correspondentName: string | null;
  authorName: string | null;
  regDate: string | null;
  createdAt: string;
  /**
   * A highlighted fragment of the document own text, with the matched words wrapped in
   * `<mark>`. Never built from an attachment: a file body has its own access gate, and a
   * snippet is a copy of that text (plan §6.11 — a snippet must not disclose text the
   * reader has no access to).
   */
  snippet: string | null;
  /** Which of the searched surfaces matched. `file` means the hit is inside an attachment. */
  matchedIn: SearchMatchSource[];
}

/** Cmd+K: the same server policy, five rows, no snippets (plan §8.8). */
export interface QuickSearchHitDto {
  id: string;
  regNumber: string | null;
  subject: string;
  docClass: DocClass;
  status: DocumentStatus;
}

/** Register an unregistered document: assign a journal and mint its number. */
export const registerDocumentSchema = z.object({
  journalId: z.string().uuid(),
  caseIndex: z.string().max(32).nullish(),
});
export type RegisterDocumentInput = z.infer<typeof registerDocumentSchema>;

/** A file to link while registering, already uploaded to fs. */
const registerIncomingFileSchema = z.object({
  fileId: z.string().uuid(),
  kind: z.enum(DOCUMENT_FILE_KINDS),
  title: z.string().max(300).nullish(),
});

/**
 * Create *and* register an incoming document in one atomic command (docs/modules/11
 * §12.2). Replaces the wizard's create → attach → register sequence, where a failure
 * between the calls left an unexpected draft behind.
 *
 * `idempotencyKey` is generated by the client once per registration attempt and reused
 * on retry: replaying the command returns the original document and its number instead
 * of minting a second one.
 */
export const registerIncomingSchema = z.object({
  idempotencyKey: z.string().uuid(),
  journalId: z.string().uuid(),
  typeCode: z.string().min(1).max(64),
  subject: z.string().min(1).max(500),
  summary: z.string().max(5000).nullish(),
  orgUnitId: z.string().uuid().nullish(),
  confidentiality: z.enum(DOCUMENT_CONFIDENTIALITY).default('normal'),
  accessList: z.array(z.string().uuid()).max(500).optional(),
  dueDate: z.string().datetime().nullish(),
  caseIndex: z.string().max(32).nullish(),
  correspondentId: z.string().uuid().nullish(),
  outgoingNumber: z.string().max(64).nullish(),
  outgoingDate: z.string().datetime().nullish(),
  delivery: z.enum(DOCUMENT_DELIVERY).nullish(),
  /** When an answer is owed back to the correspondent (docs/modules/11 §12.3). */
  responseDueAt: z.string().datetime().nullish(),
  /** Who sent the letter, as written on the paper — the answer's addressee comes from
   *  here, so the chancellery records it at registration rather than re-typing it later. */
  ...partyFields,
  // A document has one main body; extra scans go in as attachments.
  files: z
    .array(registerIncomingFileSchema)
    .max(20)
    .default([])
    .refine((files) => files.filter((f) => f.kind === 'main').length <= 1, {
      message: 'A document may have only one main file',
    }),
});
export type RegisterIncomingInput = z.infer<typeof registerIncomingSchema>;

export const changeDocumentStatusSchema = z.object({
  status: z.enum(DOCUMENT_STATUSES),
  reason: z.string().max(1000).nullish(),
});
export type ChangeDocumentStatusInput = z.infer<typeof changeDocumentStatusSchema>;

/** Attach a file (already uploaded to fs) to a document as a main body or attachment. */
export const addDocumentFileSchema = z.object({
  fileId: z.string().uuid(),
  kind: z.enum(DOCUMENT_FILE_KINDS),
  title: z.string().max(300).nullish(),
});
export type AddDocumentFileInput = z.infer<typeof addDocumentFileSchema>;

export interface DocumentFileDto {
  id: string;
  fileId: string;
  kind: DocumentFileKind;
  version: number;
  title: string | null;
  isCurrent: boolean;
  createdAt: string;
  /** The underlying fs node, so the card renders a real file row instead of a uuid. */
  name: string;
  mime: string | null;
  size: number;
  /** Antivirus verdict of the current version. `pending` and `infected` are both
   *  undownloadable through the document endpoints (docs/modules/11 §12.2). */
  avStatus: AvStatus | null;
}

export interface DocumentListItemDto {
  id: string;
  regNumber: string | null;
  docClass: DocClass;
  typeCode: string;
  subject: string;
  status: DocumentStatus;
  confidentiality: DocumentConfidentiality;
  journalName: string | null;
  authorName: string | null;
  correspondentName: string | null;
  dueDate: string | null;
  regDate: string | null;
  createdAt: string;
  /** For an action queue (to_approve/to_sign/to_acknowledge), the route step the caller
   *  may act on directly from the row; null otherwise. */
  actionStepId: string | null;
  /** When the row is actionable only via a substitution (task 3.11): the principal the caller
   *  would act «за»; null when acting as themselves. */
  actionOnBehalfOfName: string | null;
}

/** Pending-work counts for the cabinet queue badges (docs/modules/11 §7). */
export interface DocumentQueueCountsDto {
  to_approve: number;
  to_sign: number;
  to_acknowledge: number;
  my_tasks: number;
}

/** Where the document stands in the archive — null until it is filed (docs/modules/11 §12.12). */
export interface DocumentArchiveDto {
  archivedAt: string | null;
  archivedByName: string | null;
  retentionUntil: string | null;
  retentionMonths: number | null;
  isPermanent: boolean;
  legalHold: boolean;
  legalHoldReason: string | null;
  dispositionStatus: DispositionStatus;
  disposedAt: string | null;
}

export interface DocumentDetailDto extends DocumentListItemDto {
  /** Archive facts, so the card can show a hold badge and a retention date. */
  archive: DocumentArchiveDto;
  summary: string | null;
  orgUnitId: string | null;
  orgUnitName: string | null;
  journalId: string | null;
  authorId: string;
  accessList: string[];
  caseIndex: string | null;
  correspondentId: string | null;
  outgoingNumber: string | null;
  outgoingDate: string | null;
  delivery: DocumentDelivery | null;
  senderName: string | null;
  senderContact: string | null;
  recipientName: string | null;
  recipientContact: string | null;
  responseDueAt: string | null;
  /** Structured body, or null for a document that carries only files. */
  content: DocumentContent | null;
  /** The template version this document was instantiated from, if any. */
  templateVersionId: string | null;
  /** Optimistic-concurrency token to echo back in `expectedVersion` when saving. */
  version: number;
  files: DocumentFileDto[];
  collaborators: DocumentCollaboratorDto[];
  /**
   * What THIS caller may do, decided by the server policy (docs/modules/11 §12.5). The
   * card drives its action bar off this list — it never re-derives permissions from the
   * status or the author id, which is how a hidden-but-permitted (or shown-but-refused)
   * action creeps in.
   */
  availableActions: DocumentAction[];
}

// --- Collaborators (docs/modules/11 §12.5, plan §6.2) ---

export const addDocumentCollaboratorSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(DOCUMENT_COLLABORATOR_ROLES),
});
export type AddDocumentCollaboratorInput = z.infer<typeof addDocumentCollaboratorSchema>;

export interface DocumentCollaboratorDto {
  id: string;
  userId: string;
  userName: string | null;
  role: DocumentCollaboratorRole;
  assignedByName: string | null;
  createdAt: string;
}

// --- Document templates (docs/modules/11 §12.7, plan §6.3) ---

export const createDocumentTemplateSchema = z.object({
  code: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9_-]+$/i, 'The code may contain only letters, digits, "-" and "_"'),
  name: z.string().min(1).max(200),
  docClass: z.enum(DOC_CLASSES),
  documentTypeCode: z.string().max(64).nullish(),
  orgUnitId: z.string().uuid().nullish(),
  routeTemplateId: z.string().uuid().nullish(),
});
export type CreateDocumentTemplateInput = z.infer<typeof createDocumentTemplateSchema>;

/** Code is immutable after creation (it identifies the template). */
export const updateDocumentTemplateSchema = createDocumentTemplateSchema.partial().omit({
  code: true,
});
export type UpdateDocumentTemplateInput = z.infer<typeof updateDocumentTemplateSchema>;

/** A new draft version's body. Published versions are never edited (see the service). */
export const createTemplateVersionSchema = z.object({
  content: documentContentSchema,
});
export type CreateTemplateVersionInput = z.infer<typeof createTemplateVersionSchema>;

/** Create a draft document from a published template version. */
export const instantiateDocumentTemplateSchema = z.object({
  /** Which published version to use; omitted means the latest published one. */
  version: z.number().int().min(1).optional(),
  subject: z.string().min(1).max(500),
  orgUnitId: z.string().uuid().nullish(),
  correspondentId: z.string().uuid().nullish(),
  /** Start the route the template names for this document type, if it names one. */
  startRoute: z.boolean().default(false),
});
export type InstantiateDocumentTemplateInput = z.infer<typeof instantiateDocumentTemplateSchema>;

export interface DocumentTemplateVersionDto {
  id: string;
  version: number;
  content: DocumentContent | null;
  isPublished: boolean;
  publishedAt: string | null;
  publishedByName: string | null;
  createdAt: string;
  /** Variables the body uses — `unknown` ones will never resolve and are shown as a warning. */
  variables: { known: string[]; unknown: string[] };
}

export interface DocumentTemplateDto {
  id: string;
  code: string;
  name: string;
  docClass: DocClass;
  documentTypeCode: string | null;
  orgUnitId: string | null;
  orgUnitName: string | null;
  routeTemplateId: string | null;
  isActive: boolean;
  /** The highest published version, or null when the template has never been published. */
  publishedVersion: number | null;
  versions: DocumentTemplateVersionDto[];
}

// --- Timeline (docs/modules/11 §12.5) ---

/** One entry of the document's unified timeline: an audited business event, resolved to
 *  a display name. `meta` is the whitelisted subset the server chose to expose. */
export interface DocumentTimelineEntryDto {
  id: string;
  action: string;
  actorName: string | null;
  at: string;
  meta: Record<string, string | number | boolean> | null;
}

// --- Resolutions (docs/modules/11 §3/§5, task 3.4) ---

export const createResolutionSchema = z.object({
  text: z.string().min(1).max(5000),
  executorId: z.string().uuid(),
  coExecutors: z.array(z.string().uuid()).max(50).optional(),
  dueDate: z.string().datetime().nullish(),
  isControl: z.boolean().optional(),
});
export type CreateResolutionInput = z.infer<typeof createResolutionSchema>;

/** The executor's report on a resolution (docs/modules/11 §5). */
export const reportResolutionSchema = z.object({ report: z.string().min(1).max(5000) });
export type ReportResolutionInput = z.infer<typeof reportResolutionSchema>;

/** Move a controlled resolution's due date, with a reason (docs/modules/11 §5). */
export const extendResolutionSchema = z.object({
  newDue: z.string().datetime(),
  reason: z.string().min(1).max(1000),
});
export type ExtendResolutionInput = z.infer<typeof extendResolutionSchema>;

/** Remove a resolution from control (docs/modules/11 §5) — keeps it active, clears the
 *  control flag; requires a reason (audited). */
export const removeResolutionControlSchema = z.object({
  reason: z.string().min(1).max(1000),
});
export type RemoveResolutionControlInput = z.infer<typeof removeResolutionControlSchema>;

/** notification_outbox topic for docflow deadline reminders/escalations (task 3.8). The
 *  worker inserts rows under this topic; a docflow API dispatcher fans them out. */
export const DOCFLOW_DEADLINE_TOPIC = 'docflow.deadline';

export const DOCFLOW_DEADLINE_TIERS = ['due3', 'due1', 'due0', 'overdue', 'escalation'] as const;
export type DocflowDeadlineTier = (typeof DOCFLOW_DEADLINE_TIERS)[number];

/** Outbox payload the worker writes and the dispatcher validates + fans out. For a ДСП document
 *  the dispatcher shows only `regNumber` (never `subject`) in the notification (docs/09 §3). */
export const docflowDeadlinePayloadSchema = z.object({
  resolutionId: z.string().uuid(),
  documentId: z.string().uuid(),
  tier: z.enum(DOCFLOW_DEADLINE_TIERS),
  subject: z.string(),
  regNumber: z.string().nullable().optional(),
  confidential: z.boolean().optional(),
  dueDate: z.string(),
  recipientUserIds: z.array(z.string().uuid()).min(1),
});
export type DocflowDeadlinePayload = z.infer<typeof docflowDeadlinePayloadSchema>;

// --- Route step SLA (docs/modules/11 §12.9) ---

export const ROUTE_DEADLINE_TOPIC = 'docflow.route_deadline';

/** A step is warned once as it approaches its `due_at`, then reminded while it is past it. */
export const ROUTE_DEADLINE_TIERS = ['due_soon', 'overdue'] as const;
export type RouteDeadlineTier = (typeof ROUTE_DEADLINE_TIERS)[number];

/** How long before `due_at` the «due soon» warning fires. */
export const ROUTE_DUE_SOON_HOURS = 4;

/**
 * Classify an active step against its deadline (docs/modules/11 §12.9). Pure, so the
 * worker and its tests agree on the boundary without a clock.
 *
 * The window is hours, not Dushanbe days like resolution deadlines: a route step's SLA is
 * set in hours by its author, and rounding a four-hour approval to a calendar day would
 * make the warning useless.
 */
export function classifyRouteDeadline(dueAt: Date, now: Date): RouteDeadlineTier | null {
  const msLeft = dueAt.getTime() - now.getTime();
  if (msLeft < 0) return 'overdue';
  if (msLeft <= ROUTE_DUE_SOON_HOURS * 60 * 60 * 1000) return 'due_soon';
  return null;
}

/** Outbox payload for a route-step reminder. As with resolution deadlines, a ДСП document
 *  shows only its `regNumber` in the notification (docs/09 §3). */
export const routeDeadlinePayloadSchema = z.object({
  stepId: z.string().uuid(),
  documentId: z.string().uuid(),
  tier: z.enum(ROUTE_DEADLINE_TIERS),
  kind: z.enum(ROUTE_STEP_KINDS),
  subject: z.string(),
  regNumber: z.string().nullable().optional(),
  confidential: z.boolean().optional(),
  dueAt: z.string(),
  recipientUserIds: z.array(z.string().uuid()).min(1),
});
export type RouteDeadlinePayload = z.infer<typeof routeDeadlinePayloadSchema>;

// --- ДСП confidentiality / access list (docs/09-security.md §3, task 3.10) ---

/** Set a document's confidentiality grif and its access list (allow-list). ДСП requires the
 *  `docflow.confidential.view` permission AND membership in this list to view. */
export const setDocumentAccessSchema = z.object({
  confidentiality: z.enum(DOCUMENT_CONFIDENTIALITY),
  accessList: z.array(z.string().uuid()).max(500).default([]),
});
export type SetDocumentAccessInput = z.infer<typeof setDocumentAccessSchema>;

/** A member of a document's access list, resolved for display. */
export interface DocumentAccessMemberDto {
  userId: string;
  name: string | null;
}

/** The document's current confidentiality + resolved access-list members (the «Доступ» section). */
export interface DocumentAccessDto {
  confidentiality: DocumentConfidentiality;
  members: DocumentAccessMemberDto[];
  /** Whether the caller may change the grif / access list (author or confidential.view holder). */
  canManage: boolean;
}

export const READ_LOG_ENTITY_TYPES = ['document', 'file'] as const;
export type ReadLogEntityType = (typeof READ_LOG_ENTITY_TYPES)[number];

/** One ДСП access-trail entry — who opened the document (or downloaded a file), and when. */
export interface ReadLogEntryDto {
  id: string;
  entityType: ReadLogEntityType;
  actorId: string;
  actorName: string | null;
  createdAt: string;
}

/** One row of the «На контроле» view (docs/modules/11 §5): a controlled resolution or a
 *  document with a due date, with its deadline severity. */
export interface ControlItemDto {
  kind: 'resolution' | 'document';
  /** The resolution id (kind=resolution) or the document id (kind=document). */
  id: string;
  documentId: string;
  regNumber: string | null;
  subject: string;
  documentStatus: DocumentStatus;
  /** The instruction text (kind=resolution) or null (kind=document). */
  resolutionText: string | null;
  executorName: string | null;
  authorName: string | null;
  dueDate: string | null;
  severity: ControlSeverity;
  /** Whether the caller may extend / remove from control (author or control officer). */
  canManage: boolean;
}

export interface ResolutionExtensionDto {
  id: string;
  oldDue: string | null;
  newDue: string;
  reason: string;
  extendedByName: string | null;
  createdAt: string;
}

export interface ResolutionDto {
  id: string;
  parentId: string | null;
  authorId: string;
  authorName: string | null;
  executorId: string;
  executorName: string | null;
  coExecutors: string[];
  coExecutorNames: string[];
  text: string;
  dueDate: string | null;
  isControl: boolean;
  status: ResolutionStatus;
  report: string | null;
  doneAt: string | null;
  createdAt: string;
  extensions: ResolutionExtensionDto[];
  /** Whether the caller may report/complete (executor/co-executor) or manage (author/control). */
  canReport: boolean;
  canManage: boolean;
  /** Children are the same shape (sub-resolutions), nested by the server. */
  children: ResolutionDto[];
}

// --- Digital signatures / ЭЦП (docs/09-security.md §4, task 3.5) ---

/** Activate signing on a device: the browser generates an ECDSA P-256 key
 *  (`extractable: false`, kept in IndexedDB) and sends its public key (SPKI, base64) so
 *  the CA can issue a certificate. `deviceLabel` names the device for later revocation. */
export const activateCertificateSchema = z.object({
  publicKeySpki: z.string().min(1).max(4000),
  deviceLabel: z.string().min(1).max(120),
});
export type ActivateCertificateInput = z.infer<typeof activateCertificateSchema>;

/** Sign a document at its active `sign` route step. The client fetches the canonical
 *  sign payload (GET .../sign-payload), signs it with the device key, and posts the
 *  raw (IEEE P1363) ECDSA signature as base64 together with the certificate used. */
export const signDocumentSchema = z.object({
  certificateId: z.string().uuid(),
  signature: z.string().min(1).max(4000),
  /** Step-up re-authentication — signing is a conscious action (docs/09-security.md §4). */
  password: z.string().min(1).max(200),
});
export type SignDocumentInput = z.infer<typeof signDocumentSchema>;

/**
 * The exact string that is signed for a document (docs/09-security.md §4): a
 * deterministic JSON of the file-version hash plus the card requisites. The explicit
 * key order and the JSON encoding MUST be identical on the browser (which signs) and
 * the server (which verifies) — do not reorder fields or the signature breaks.
 */
export function buildSignPayload(input: {
  fileSha256: string;
  regNumber: string | null;
  regDate: string | null;
  subject: string;
}): string {
  return JSON.stringify({
    v: 1,
    fileSha256: input.fileSha256,
    regNumber: input.regNumber ?? null,
    regDate: input.regDate ?? null,
    subject: input.subject,
  });
}

/** The bytes the client must sign: the server's canonical payload plus the components
 *  that produced it (so the modal can show what is being signed). */
export interface SignPayloadDto {
  /** The exact canonical string to sign (deterministic JSON). */
  payload: string;
  /** SHA-256 (hex) of the file version being signed. */
  fileSha256: string;
  /** The requisites snapshot embedded in the payload. */
  requisites: { regNumber: string | null; regDate: string | null; subject: string };
  /** The file version id that will be recorded as signed. */
  docVersionId: string;
}

export interface CertificateDto {
  id: string;
  serial: string;
  kind: string;
  deviceLabel: string;
  subject: { username: string; fullName: string; position: string | null };
  notBefore: string;
  notAfter: string;
  revokedAt: string | null;
  createdAt: string;
}

export interface SignatureDto {
  id: string;
  userId: string;
  userName: string | null;
  /** Set when a deputy signed «за» an absent principal (task 3.11): who they signed for. */
  onBehalfOfId: string | null;
  onBehalfOfName: string | null;
  certificateId: string;
  certificateSerial: string;
  algorithm: SignatureAlgorithm;
  context: SignatureContext;
  signedAt: string;
  /** True if this signature still verifies against the document's current file version. */
  valid: boolean;
}

/** A single check in the verification report, with a human-readable label. */
export interface VerifyCheckDto {
  key: 'signature' | 'chain' | 'revocation' | 'file_hash';
  ok: boolean;
}

/** The result of GET /verify/:signatureId (docs/09-security.md §4). */
export interface VerifyResultDto {
  signatureId: string;
  valid: boolean;
  checks: VerifyCheckDto[];
  signerName: string | null;
  signerPosition: string | null;
  /** The person signed FOR, when a deputy signed «за» (task 3.11). */
  onBehalfOfName: string | null;
  certificateSerial: string;
  context: SignatureContext;
  signedAt: string;
  documentId: string;
  documentSubject: string;
  documentRegNumber: string | null;
}

// --- Acknowledgements / ознакомление (docs/modules/11 §3/§6, task 3.6) ------

/** One line of a document's acknowledgement sheet: an employee who must read the order,
 *  and when they did (null = still pending). */
export interface AcquaintanceDto {
  id: string;
  userId: string;
  userName: string | null;
  position: string | null;
  acknowledgedAt: string | null;
}

/** The acknowledgement sheet of a document (docs/modules/11 §3), plus whether the caller
 *  has a pending line they can act on. */
export interface AcknowledgementSheetDto {
  rows: AcquaintanceDto[];
  total: number;
  acknowledged: number;
  /** True when the caller has an unacknowledged line on an active acknowledge step. */
  canAcknowledge: boolean;
  /** The active acknowledge step the caller acknowledges against (null when none). */
  stepId: string | null;
}

// --- Document links / связи + history (docs/modules/11 §3/§7, task 3.7) ------

/** Link the current document to another (docs/modules/11 §3). */
export const createDocumentLinkSchema = z.object({
  targetId: z.string().uuid(),
  kind: z.enum(DOCUMENT_LINK_KINDS).default('related'),
});
export type CreateDocumentLinkInput = z.infer<typeof createDocumentLinkSchema>;

/** A related document as shown on the «Связи» tab (bidirectional). */
export interface DocumentLinkDto {
  id: string;
  kind: DocumentLinkKind;
  documentId: string;
  regNumber: string | null;
  subject: string;
  status: DocumentStatus;
  createdAt: string;
}

/** One entry of a document's «История» tab — an audit event on the document. */
export interface DocumentHistoryEntryDto {
  id: string;
  action: string;
  actorName: string | null;
  createdAt: string;
}

// --- Executive-discipline report / Отчёт исполнительской дисциплины (docs/modules/11 §5, task 3.9) ---

/**
 * Period for the discipline report. `from`/`to` are ISO datetimes; the report counts
 * resolutions whose `due_date` falls in the (inclusive) window. `orgUnitId` narrows to that
 * subdivision and its subtree.
 */
export const disciplineReportQuerySchema = z
  .object({
    from: z.string().datetime({ offset: true }),
    to: z.string().datetime({ offset: true }),
    orgUnitId: z.string().uuid().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.from >= value.to) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['from'],
        message: 'from must be before to',
      });
    }
  });
export type DisciplineReportQuery = z.infer<typeof disciplineReportQuerySchema>;

/** The four discipline buckets plus the derived percentage; shared by rows, subtotals, total. */
export interface DisciplineTotals {
  /** All non-cancelled instructions due in the period. */
  total: number;
  /** Done on or before the deadline. */
  onTime: number;
  /** Done after the deadline. */
  late: number;
  /** Still open (not done). */
  notDone: number;
  /** onTime / total, rounded to a whole percent; null when total is 0. */
  disciplinePct: number | null;
}

/** One executor's discipline line within a subdivision. */
export interface DisciplineRowDto extends DisciplineTotals {
  executorId: string;
  executorName: string;
}

/** A subdivision with its executors and its subtotal. */
export interface DisciplineGroupDto extends DisciplineTotals {
  /** null groups executors with no primary position (see orgUnitName). */
  orgUnitId: string | null;
  orgUnitName: string;
  rows: DisciplineRowDto[];
}

/** The full report: subdivisions (each with executors) and a grand total. */
export interface DisciplineReportDto {
  from: string;
  to: string;
  groups: DisciplineGroupDto[];
  totals: DisciplineTotals;
}

// --- Resolution proposals + acquaintance gate (docs/modules/11 §12.11) ---

export const createResolutionProposalSchema = z.object({
  text: z.string().min(1).max(5000),
  signerId: z.string().uuid(),
  resolutionTypeId: z.string().uuid().nullish(),
  responsibleExecutorId: z.string().uuid().nullish(),
  coExecutorIds: z.array(z.string().uuid()).max(50).default([]),
  /** Who must read the document BEFORE the executors get their instruction. */
  acquaintUserIds: z.array(z.string().uuid()).max(200).default([]),
  dueAt: z.string().datetime().nullish(),
  isControl: z.boolean().default(false),
});
export type CreateResolutionProposalInput = z.infer<typeof createResolutionProposalSchema>;

export const updateResolutionProposalSchema = createResolutionProposalSchema.partial();
export type UpdateResolutionProposalInput = z.infer<typeof updateResolutionProposalSchema>;

/** A rejection must say why — the author has to know what to fix (docs/modules/11 §12.11). */
export const rejectResolutionProposalSchema = z.object({ comment: z.string().min(1).max(2000) });
export type RejectResolutionProposalInput = z.infer<typeof rejectResolutionProposalSchema>;

export const approveResolutionProposalSchema = z.object({
  comment: z.string().max(2000).nullish(),
});
export type ApproveResolutionProposalInput = z.infer<typeof approveResolutionProposalSchema>;

export interface AcquaintanceLineDto {
  userId: string;
  userName: string | null;
  status: AcquaintanceStatus;
  acknowledgedAt: string | null;
}

/** The pre-execution gate's live state, as the card shows it. */
export interface AcquaintanceGateDto {
  id: string;
  releaseAt: string | null;
  releasedAt: string | null;
  releasedReason: AcquaintanceReleaseReason | null;
  lines: AcquaintanceLineDto[];
}

export interface ResolutionProposalDto {
  id: string;
  documentId: string;
  text: string;
  status: ResolutionProposalStatus;
  signerId: string;
  signerName: string | null;
  resolutionTypeId: string | null;
  responsibleExecutorId: string | null;
  responsibleExecutorName: string | null;
  coExecutorIds: string[];
  acquaintUserIds: string[];
  dueAt: string | null;
  isControl: boolean;
  proposedByName: string | null;
  submittedAt: string | null;
  decidedByName: string | null;
  /** The principal a deputy decided «за»; null for a self decision. */
  decidedForName: string | null;
  decidedAt: string | null;
  decisionComment: string | null;
  resolutionId: string | null;
  /** Whether THIS caller may decide it — the signer or their active deputy. */
  canDecide: boolean;
  /** Whether THIS caller may still edit or submit it — its drafter, before a decision. */
  canEdit: boolean;
  /** The gate the approval created, once it exists. */
  gate: AcquaintanceGateDto | null;
  createdAt: string;
}

export interface ResolutionTypeDto {
  id: string;
  code: string;
  nameRu: string;
  nameTj: string;
  actionKind: ResolutionActionKind;
  requiresDueAt: boolean;
  requiresExecutor: boolean;
  requiresOutgoingResponse: boolean;
  defaultControl: boolean;
  defaultDueHours: number | null;
  isActive: boolean;
  sortOrder: number;
}

/**
 * A resolution type carries what the chancellery may pre-fill and insist on for an
 * instruction of that kind — «Исполнить» wants an executor and a deadline, «Ознакомить»
 * wants neither (docs/modules/11 §12.11).
 */
export const createResolutionTypeSchema = z.object({
  code: z
    .string()
    .min(2)
    .max(40)
    .regex(/^[a-z][a-z0-9_]*$/, 'Only lowercase latin, digits and underscore'),
  nameRu: z.string().min(1).max(200),
  nameTj: z.string().min(1).max(200),
  actionKind: z.enum(RESOLUTION_ACTION_KINDS).default('execute'),
  requiresDueAt: z.boolean().default(false),
  requiresExecutor: z.boolean().default(true),
  requiresOutgoingResponse: z.boolean().default(false),
  defaultControl: z.boolean().default(false),
  /** Hours from approval; null means «no default», not «immediately». */
  defaultDueHours: z
    .number()
    .int()
    .min(1)
    .max(24 * 365)
    .nullish(),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(9999).default(0),
});
export type CreateResolutionTypeInput = z.infer<typeof createResolutionTypeSchema>;

/** The code is immutable once issued — proposals and reports quote it. */
export const updateResolutionTypeSchema = createResolutionTypeSchema.omit({ code: true }).partial();
export type UpdateResolutionTypeInput = z.infer<typeof updateResolutionTypeSchema>;

// --- Outgoing response + dispatch (docs/modules/11 §12.3, plan §6.8/§7.7) ---

/**
 * Draft the answer to an incoming document (plan §5.4). Deliberately NOT derived from
 * `createDocumentSchema`: that shape carries `confidentiality` and `accessList`, and the
 * response must inherit those from the source rather than let the caller choose — an answer
 * that is less restricted than the letter it quotes leaks the letter.
 */
export const createResponseSchema = z.object({
  typeCode: z.string().min(1).max(64).default('letter'),
  /** Defaults server-side to «Ответ на {номер}» when omitted. */
  subject: z.string().min(1).max(500).optional(),
  summary: z.string().max(5000).nullish(),
  orgUnitId: z.string().uuid().nullish(),
  /** Internal deadline for preparing the answer, not the promise made to the correspondent. */
  dueDate: z.string().datetime().nullish(),
  delivery: z.enum(DOCUMENT_DELIVERY).nullish(),
  /** Who prepares it — added as a `preparer` collaborator in the same transaction. */
  preparerId: z.string().uuid().nullish(),
  /** Start the preset approval route (head → optional approvals → sign → register). */
  startRoute: z.boolean().default(false),
  /** Extra approvers for the preset route, all in one parallel group after the head. */
  approverIds: z.array(z.string().uuid()).max(10).default([]),
  /** Who signs. Defaults to the head of the preparing unit. */
  signerId: z.string().uuid().nullish(),
});
export type CreateResponseInput = z.infer<typeof createResponseSchema>;

export const createDispatchSchema = z.object({
  channel: z.enum(DISPATCH_CHANNELS),
  recipientName: z.string().min(1).max(300),
  recipientAddress: z.string().max(500).nullish(),
  recipientContact: z.string().max(300).nullish(),
  /** Track number, postal receipt id, or the integration's own message id. */
  externalReference: z.string().max(200).nullish(),
  note: z.string().max(2000).nullish(),
});
export type CreateDispatchInput = z.infer<typeof createDispatchSchema>;

/** Confirm a send actually happened, optionally attaching the scanned receipt. */
export const confirmDispatchSchema = z.object({
  externalReference: z.string().max(200).nullish(),
  /** An already-uploaded fs node; adopted into the document's system space on confirm. */
  receiptFileId: z.string().uuid().nullish(),
  sentAt: z.string().datetime().nullish(),
  note: z.string().max(2000).nullish(),
});
export type ConfirmDispatchInput = z.infer<typeof confirmDispatchSchema>;

/** A failure must say why — the next attempt is decided from this text. */
export const failDispatchSchema = z.object({
  failureCode: z.string().min(1).max(64).default('manual'),
  failureMessage: z.string().min(1).max(2000),
});
export type FailDispatchInput = z.infer<typeof failDispatchSchema>;

export const cancelDispatchSchema = z.object({
  reason: z.string().max(2000).nullish(),
});
export type CancelDispatchInput = z.infer<typeof cancelDispatchSchema>;

/** The scanned confirmation of a send, read through the document policy like any body. */
export interface DispatchReceiptDto {
  fileId: string;
  name: string;
  size: number;
  mime: string | null;
  avStatus: AvStatus | null;
}

export interface DocumentDispatchDto {
  id: string;
  documentId: string;
  channel: DispatchChannel;
  status: DispatchStatus;
  recipientName: string;
  recipientAddress: string | null;
  recipientContact: string | null;
  externalReference: string | null;
  note: string | null;
  failureCode: string | null;
  failureMessage: string | null;
  attemptedAt: string | null;
  sentAt: string | null;
  createdByName: string | null;
  confirmedByName: string | null;
  receipt: DispatchReceiptDto | null;
  /** Whether THIS caller may still act on the attempt — the chancellery, while pending. */
  canAct: boolean;
  createdAt: string;
}

// --- Internal distribution (docs/modules/11 §12.4, plan этап 7) ---

/**
 * One address a distribution is sent to. `includeSubtree` only applies to an org unit and
 * must be asked for explicitly: «отделу» and «управлению со всеми отделами» are different
 * instructions, and silently choosing the wider one puts an order in front of people the
 * author never meant to reach.
 */
export const distributionTargetSchema = z.object({
  type: z.enum(DISTRIBUTION_TARGET_TYPES),
  id: z.string().uuid(),
  includeSubtree: z.boolean().default(false),
});
export type DistributionTargetInput = z.infer<typeof distributionTargetSchema>;

export const createDistributionSchema = z.object({
  targets: z.array(distributionTargetSchema).min(1).max(100),
  /** Optional deadline; the batch opens by itself once it passes, marking silence expired. */
  dueAt: z.string().datetime().nullish(),
  note: z.string().max(2000).nullish(),
});
export type CreateDistributionInput = z.infer<typeof createDistributionSchema>;

export interface DistributionReaderDto {
  userId: string;
  userName: string | null;
  position: string | null;
  status: AcquaintanceStatus;
  acknowledgedAt: string | null;
}

export interface DistributionDto {
  id: string;
  documentId: string;
  /** When it opens by itself; null means it waits for everyone, however long that takes. */
  releaseAt: string | null;
  releasedAt: string | null;
  releasedReason: AcquaintanceReleaseReason | null;
  createdByName: string | null;
  createdAt: string;
  readers: DistributionReaderDto[];
  /** Whether THIS caller still owes a reading on this batch. */
  canAcknowledge: boolean;
}

// --- Acknowledgement report (plan этап 7 «отчёт по ознакомлению») ---

export const acknowledgementReportQuerySchema = z
  .object({
    from: z.string().datetime({ offset: true }),
    to: z.string().datetime({ offset: true }),
    orgUnitId: z.string().uuid().optional(),
  })
  .superRefine((v, ctx) => {
    if (new Date(v.from) > new Date(v.to)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'from must be before to',
        path: ['to'],
      });
    }
  });
export type AcknowledgementReportQuery = z.infer<typeof acknowledgementReportQuerySchema>;

export interface AcknowledgementReportRowDto {
  documentId: string;
  regNumber: string | null;
  subject: string;
  userName: string | null;
  orgUnitName: string | null;
  status: AcquaintanceStatus;
  acknowledgedAt: string | null;
}

export interface AcknowledgementReportDto {
  from: string;
  to: string;
  rows: AcknowledgementReportRowDto[];
  totals: {
    total: number;
    acknowledged: number;
    pending: number;
    /** The gate opened without them — never counted as compliance. */
    expired: number;
  };
  /** Rows the caller may not see were dropped, not redacted; this says how many. */
  hiddenCount: number;
}

// --- Archive, retention and disposition (docs/modules/11 §12.12, plan §6.9/§7.8) ---

/** Filing a document into its case. The case index is what the retention term is read from. */
export const archiveDocumentSchema = z.object({
  caseIndex: z.string().max(32).nullish(),
  note: z.string().max(1000).nullish(),
});
export type ArchiveDocumentInput = z.infer<typeof archiveDocumentSchema>;

/** Taking it back out — always with a reason, because the archive is a record of decisions. */
export const restoreDocumentSchema = z.object({
  reason: z.string().min(1).max(1000),
});
export type RestoreDocumentInput = z.infer<typeof restoreDocumentSchema>;

/** A hold nobody can explain is a hold nobody can lift, so the reason is mandatory both ways. */
export const legalHoldSchema = z.object({
  reason: z.string().min(1).max(1000),
});
export type LegalHoldInput = z.infer<typeof legalHoldSchema>;

/** The archive view of a document: where it is filed, until when, and what holds it. */
export interface ArchiveEntryDto {
  documentId: string;
  regNumber: string | null;
  subject: string;
  docClass: DocClass;
  caseIndex: string | null;
  caseTitle: string | null;
  archivedAt: string | null;
  archivedByName: string | null;
  retentionUntil: string | null;
  retentionMonths: number | null;
  isPermanent: boolean;
  legalHold: boolean;
  legalHoldReason: string | null;
  dispositionStatus: DispositionStatus;
  confidentiality: DocumentConfidentiality;
}

export const archiveQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  caseIndex: z.string().max(32).optional(),
  search: z.string().max(200).optional(),
  /** Only the documents whose term has run out and which nothing has decided about. */
  candidatesOnly: z.preprocess(
    (v) => (v === undefined ? undefined : v === 'true' || v === true),
    z.boolean().optional(),
  ),
  legalHoldOnly: z.preprocess(
    (v) => (v === undefined ? undefined : v === 'true' || v === true),
    z.boolean().optional(),
  ),
});
export type ArchiveQuery = z.infer<typeof archiveQuerySchema>;

export const createDispositionBatchSchema = z.object({
  number: z.string().min(1).max(64),
  reason: z.string().min(1).max(2000),
  /** The documents the act proposes to dispose of; more may be added while it is a draft. */
  documentIds: z.array(z.string().uuid()).max(500).default([]),
});
export type CreateDispositionBatchInput = z.infer<typeof createDispositionBatchSchema>;

export const dispositionDecisionSchema = z.object({
  comment: z.string().max(2000).nullish(),
});
export type DispositionDecisionInput = z.infer<typeof dispositionDecisionSchema>;

export const dispositionItemsSchema = z.object({
  documentIds: z.array(z.string().uuid()).min(1).max(500),
});
export type DispositionItemsInput = z.infer<typeof dispositionItemsSchema>;

export interface DispositionItemDto {
  documentId: string;
  regNumber: string | null;
  subject: string;
  caseIndex: string | null;
  retentionUntil: string | null;
  legalHold: boolean;
  decision: DispositionItemDecision;
  comment: string | null;
  /**
   * True when THIS caller may not see the document itself. The row still counts — the size of
   * an act is a fact of the act — but its requisites are withheld, because the archive-dispose
   * right is not a ДСП clearance (docs/09 §3). A caller with a restricted row also cannot
   * approve the act: reviewing a list you are not allowed to read is not review.
   */
  restricted: boolean;
}

export interface DispositionBatchDto {
  id: string;
  number: string;
  status: DispositionBatchStatus;
  reason: string;
  decisionComment: string | null;
  createdByName: string | null;
  approvedByName: string | null;
  submittedAt: string | null;
  decidedAt: string | null;
  executedAt: string | null;
  createdAt: string;
  items: DispositionItemDto[];
  /**
   * Whether THIS caller may still decide it — a reviewer who is not its author, and who can
   * read every document on the list.
   */
  canDecide: boolean;
  /** How many rows are withheld from this caller; 0 for somebody who may see the whole act. */
  restrictedCount: number;
}
