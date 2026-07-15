import { z } from 'zod';
import {
  DOC_CLASSES,
  JOURNAL_SEQ_RESETS,
  type DocClass,
  type JournalSeqReset,
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
  activeOnly: z.coerce.boolean().optional(),
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
