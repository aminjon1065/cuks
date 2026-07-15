import { z } from 'zod';
import {
  DOC_CLASSES,
  DOCUMENT_CONFIDENTIALITY,
  DOCUMENT_DELIVERY,
  DOCUMENT_FILE_KINDS,
  DOCUMENT_STATUSES,
  JOURNAL_SEQ_RESETS,
  ROUTE_ASSIGNEE_TYPES,
  ROUTE_STEP_KINDS,
  type DocClass,
  type DocumentConfidentiality,
  type DocumentDelivery,
  type DocumentFileKind,
  type DocumentStatus,
  type JournalSeqReset,
  type RouteAssigneeType,
  type RouteStatus,
  type RouteStepDecision,
  type RouteStepKind,
  type RouteStepStatus,
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
  actedAt: string | null;
  dueHours: number | null;
  /** Whether the current caller may act on this step (assignee match + active). */
  canAct: boolean;
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

export const DOCUMENT_QUEUES = ['mine', 'drafts', 'authored', 'registry', 'to_approve'] as const;
export type DocumentQueue = (typeof DOCUMENT_QUEUES)[number];

export const listDocumentsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  queue: z.enum(DOCUMENT_QUEUES).default('mine'),
  status: z.enum(DOCUMENT_STATUSES).optional(),
  docClass: z.enum(DOC_CLASSES).optional(),
  journalId: z.string().uuid().optional(),
  search: z.string().max(200).optional(),
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
