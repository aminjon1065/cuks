import { z } from 'zod';
import {
  INCIDENT_RESOURCE_KINDS,
  INCIDENT_SOURCES,
  INCIDENT_STATUSES,
  INCIDENT_SEVERITY_MAX,
  INCIDENT_SEVERITY_MIN,
  incidentStatusTransition,
  type IncidentResourceKind,
  type IncidentSource,
  type IncidentStatus,
} from '../enums/index';
import { paginationQuerySchema } from './pagination';

const isoDateTimeSchema = z.string().datetime({ offset: true });
const nonNegativeInt = z.coerce.number().int().min(0);
const optionalText = z.string().trim().min(1).max(10_000).optional();
const optionalMoney = z
  .string()
  .regex(/^\d{1,16}(?:\.\d{1,2})?$/, 'Expected a non-negative amount with up to two decimals')
  .optional();

/** WGS84 point selected in the incident mini-map or entered as coordinates. */
export const incidentLocationSchema = z.object({
  longitude: z.coerce.number().finite().min(-180).max(180),
  latitude: z.coerce.number().finite().min(-90).max(90),
});
export type IncidentLocationInput = z.infer<typeof incidentLocationSchema>;

/** Registry filters are deliberately flat query parameters (docs/04 §REST). */
const incidentRegistryFilterFields = {
  from: isoDateTimeSchema.optional(),
  to: isoDateTimeSchema.optional(),
  typeCode: z.string().trim().min(1).max(120).optional(),
  severity: z.coerce
    .number()
    .int()
    .min(INCIDENT_SEVERITY_MIN)
    .max(INCIDENT_SEVERITY_MAX)
    .optional(),
  status: z.enum(INCIDENT_STATUSES).optional(),
  regionId: z.string().uuid().optional(),
  search: z.string().trim().min(1).max(200).optional(),
};

function validateIncidentDateRange(
  value: { from?: string | undefined; to?: string | undefined },
  ctx: z.RefinementCtx,
): void {
  if (value.from && value.to && new Date(value.from) > new Date(value.to)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: '`from` must be before `to`',
      path: ['to'],
    });
  }
}

export const incidentRegistryFilterSchema = z
  .object(incidentRegistryFilterFields)
  .superRefine(validateIncidentDateRange);
export type IncidentRegistryFilters = z.infer<typeof incidentRegistryFilterSchema>;

export const listIncidentsQuerySchema = paginationQuerySchema
  .merge(z.object(incidentRegistryFilterFields))
  .extend({
    sort: z
      .enum(['occurredAt', '-occurredAt', 'reportedAt', '-reportedAt', 'number', '-number'])
      .default('-occurredAt'),
  })
  .superRefine(validateIncidentDateRange);
export type ListIncidentsQuery = z.infer<typeof listIncidentsQuerySchema>;

/** Fast first report: creates the incident and its immutable first chronology entry. */
export const createIncidentSchema = z.object({
  typeCode: z.string().trim().min(1).max(120),
  severity: z.coerce.number().int().min(INCIDENT_SEVERITY_MIN).max(INCIDENT_SEVERITY_MAX),
  occurredAt: isoDateTimeSchema,
  location: incidentLocationSchema,
  addressText: z.string().trim().min(1).max(500).optional(),
  description: optionalText,
  source: z.enum(INCIDENT_SOURCES).default('phone'),
  dead: nonNegativeInt.default(0),
  injured: nonNegativeInt.default(0),
  evacuated: nonNegativeInt.default(0),
  affected: nonNegativeInt.default(0),
  damageEst: optionalMoney,
  damageNote: z.string().trim().min(1).max(1_000).optional(),
});
export type CreateIncidentInput = z.infer<typeof createIncidentSchema>;

/** A new report is the only way to update casualty and damage snapshots. */
export const createIncidentReportSchema = z
  .object({
    reportedAt: isoDateTimeSchema.optional(),
    text: optionalText,
    dead: nonNegativeInt.optional(),
    injured: nonNegativeInt.optional(),
    evacuated: nonNegativeInt.optional(),
    affected: nonNegativeInt.optional(),
    damageEst: optionalMoney,
    damageNote: z.string().trim().min(1).max(1_000).optional(),
  })
  .superRefine((value, ctx) => {
    if (
      !value.text &&
      value.dead === undefined &&
      value.injured === undefined &&
      value.evacuated === undefined &&
      value.affected === undefined &&
      value.damageEst === undefined &&
      value.damageNote === undefined
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'A report needs text or at least one updated figure',
      });
    }
  });
export type CreateIncidentReportInput = z.infer<typeof createIncidentReportSchema>;

/** Optimistic status command; the server row-locks and verifies expectedStatus. */
export const changeIncidentStatusSchema = z
  .object({
    expectedStatus: z.enum(INCIDENT_STATUSES),
    status: z.enum(INCIDENT_STATUSES),
    reason: z.string().trim().min(1).max(1_000).optional(),
  })
  .superRefine((value, ctx) => {
    if (
      incidentStatusTransition(value.expectedStatus, value.status) === 'rollback' &&
      !value.reason
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'A rollback reason is required',
        path: ['reason'],
      });
    }
  });
export type ChangeIncidentStatusInput = z.infer<typeof changeIncidentStatusSchema>;

export const createIncidentResourceSchema = z.object({
  kind: z.enum(INCIDENT_RESOURCE_KINDS),
  name: z.string().trim().min(1).max(300),
  qty: z.coerce.number().int().min(1).max(1_000_000).default(1),
  orgText: z.string().trim().min(1).max(300).optional(),
  period: z.string().trim().min(1).max(300).optional(),
});
export type CreateIncidentResourceInput = z.infer<typeof createIncidentResourceSchema>;

export const createSavedIncidentFilterSchema = z.object({
  name: z.string().trim().min(1).max(120),
  params: incidentRegistryFilterSchema,
});
export type CreateSavedIncidentFilterInput = z.infer<typeof createSavedIncidentFilterSchema>;

export interface IncidentListItemDto {
  id: string;
  number: string;
  typeCode: string;
  typeName: string;
  severity: 1 | 2 | 3 | 4 | 5;
  status: IncidentStatus;
  occurredAt: string;
  regionName: string | null;
  districtName: string | null;
  dead: number;
  injured: number;
  damageEst: string | null;
  ownerName: string | null;
}

export interface IncidentReportDto {
  id: string;
  reportedAt: string;
  text: string | null;
  dead: number | null;
  injured: number | null;
  evacuated: number | null;
  affected: number | null;
  damageEst: string | null;
  damageNote: string | null;
  authorName: string | null;
}

export interface IncidentResourceDto {
  id: string;
  kind: IncidentResourceKind;
  name: string;
  qty: number;
  orgText: string | null;
  period: string | null;
  createdAt: string;
}

export interface IncidentAuditEventDto {
  id: string;
  action: string;
  createdAt: string;
  actorName: string | null;
  meta: Record<string, unknown> | null;
}

export interface IncidentDetailDto extends IncidentListItemDto {
  reportedAt: string;
  addressText: string | null;
  description: string | null;
  source: IncidentSource;
  closedAt: string | null;
  closedByName: string | null;
  evacuated: number;
  affected: number;
  damageNote: string | null;
  location: IncidentLocationInput;
  reports: IncidentReportDto[];
  resources: IncidentResourceDto[];
  events: IncidentAuditEventDto[];
}

export interface SavedIncidentFilterDto {
  id: string;
  name: string;
  params: IncidentRegistryFilters;
  createdAt: string;
}
