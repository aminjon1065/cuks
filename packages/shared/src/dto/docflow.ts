import { z } from 'zod';
import {
  DOC_CLASSES,
  DOCUMENT_CONFIDENTIALITY,
  DOCUMENT_DELIVERY,
  DOCUMENT_FILE_KINDS,
  DOCUMENT_LINK_KINDS,
  DOCUMENT_STATUSES,
  JOURNAL_SEQ_RESETS,
  ROUTE_ASSIGNEE_TYPES,
  ROUTE_STEP_KINDS,
  type ControlSeverity,
  type DocumentLinkKind,
  type DocClass,
  type DocumentConfidentiality,
  type DocumentDelivery,
  type DocumentFileKind,
  type DocumentStatus,
  type JournalSeqReset,
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
  sort: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
});
export type CreateNomenclatureInput = z.infer<typeof createNomenclatureSchema>;

/** Index is immutable after creation (it identifies the case). */
export const updateNomenclatureSchema = z.object({
  title: z.string().min(1).max(300).optional(),
  orgUnitId: z.string().uuid().nullish(),
  retentionNote: z.string().max(200).nullish(),
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

export const createDocumentSchema = z.object({
  docClass: z.enum(DOC_CLASSES),
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
});
export type CreateDocumentInput = z.infer<typeof createDocumentSchema>;

/** All fields optional; only a draft may be edited (enforced server-side). */
export const updateDocumentSchema = createDocumentSchema.partial().omit({ docClass: true });
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
});
export type ListDocumentsQuery = z.infer<typeof listDocumentsQuerySchema>;

/** Register an unregistered document: assign a journal and mint its number. */
export const registerDocumentSchema = z.object({
  journalId: z.string().uuid(),
  caseIndex: z.string().max(32).nullish(),
});
export type RegisterDocumentInput = z.infer<typeof registerDocumentSchema>;

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

export interface DocumentDetailDto extends DocumentListItemDto {
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
  files: DocumentFileDto[];
  canEdit: boolean;
  canRegister: boolean;
  canChangeStatus: boolean;
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
