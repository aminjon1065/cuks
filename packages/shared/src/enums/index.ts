/**
 * Domain enums shared by the DB schema (text + CHECK) and the frontend.
 * Single source of truth: the Drizzle schema imports these arrays so DB and UI
 * never drift (docs/04 §TypeScript — `as const` unions, no TS `enum`).
 */

export const USER_STATUSES = ['active', 'blocked'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const THEMES = ['system', 'light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];

export const ORG_UNIT_TYPES = ['committee', 'department', 'division', 'unit'] as const;
export type OrgUnitType = (typeof ORG_UNIT_TYPES)[number];

export const ACL_SUBJECT_TYPES = ['user', 'org_unit', 'role'] as const;
export type AclSubjectType = (typeof ACL_SUBJECT_TYPES)[number];

export const ACL_RESOURCE_TYPES = [
  'folder',
  'file',
  'layer',
  'project',
  'channel',
  'recording',
  'report',
] as const;
export type AclResourceType = (typeof ACL_RESOURCE_TYPES)[number];

export const ACL_LEVELS = ['viewer', 'editor', 'manager'] as const;
export type AclLevel = (typeof ACL_LEVELS)[number];

/** ACL levels are ordered viewer < editor < manager (docs/05 §3). */
export const ACL_LEVEL_RANK: Record<AclLevel, number> = { viewer: 1, editor: 2, manager: 3 };

/** True if `have` grants at least `need`. */
export function aclLevelSatisfies(have: AclLevel, need: AclLevel): boolean {
  return ACL_LEVEL_RANK[have] >= ACL_LEVEL_RANK[need];
}

/** fs_nodes (docs/modules/12 §3). */
export const FS_NODE_KINDS = ['folder', 'file'] as const;
export type FsNodeKind = (typeof FS_NODE_KINDS)[number];

/** `system` = module attachments (docflow, chat, …), not shown in the file tree. */
export const FS_SPACES = ['personal', 'org', 'system'] as const;
export type FsSpace = (typeof FS_SPACES)[number];

/** ClamAV verdict on a file_version (docs/09 §2). */
export const AV_STATUSES = ['pending', 'clean', 'infected'] as const;
export type AvStatus = (typeof AV_STATUSES)[number];

/**
 * Dictionary types (docs/07 §dictionaries). Extended as modules land; the full
 * incident-type tree is seeded in phase 2.1 (docs/modules/10).
 */
export const DICTIONARY_TYPES = [
  'incident_type',
  'hazard_level',
  'doc_type',
  'correspondent_category',
] as const;
export type DictionaryType = (typeof DICTIONARY_TYPES)[number];

// --- GIS / incidents (docs/modules/10, phase 2) ---

/** Administrative division levels (gis.admin_units). */
export const ADMIN_UNIT_LEVELS = ['region', 'district', 'jamoat'] as const;
export type AdminUnitLevel = (typeof ADMIN_UNIT_LEVELS)[number];

/** Incident lifecycle (docs/modules/10 §2): reported → active → localized →
 *  eliminated → closed. Rollback needs `incidents.manage` + a reason. */
export const INCIDENT_STATUSES = [
  'reported',
  'active',
  'localized',
  'eliminated',
  'closed',
] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

export type IncidentStatusTransition = 'forward' | 'rollback' | 'invalid';

/**
 * The lifecycle only advances one operational step at a time. A manager may
 * return to any earlier step, but the command schema requires a reason for that
 * rollback (docs/modules/10 §2).
 */
export function incidentStatusTransition(
  from: IncidentStatus,
  to: IncidentStatus,
): IncidentStatusTransition {
  const fromIndex = INCIDENT_STATUSES.indexOf(from);
  const toIndex = INCIDENT_STATUSES.indexOf(to);
  if (toIndex === fromIndex + 1) return 'forward';
  if (toIndex < fromIndex) return 'rollback';
  return 'invalid';
}

/** Targets shown by the status dialog: the next step plus every earlier step. */
export function availableIncidentStatusTargets(from: IncidentStatus): IncidentStatus[] {
  const currentIndex = INCIDENT_STATUSES.indexOf(from);
  return INCIDENT_STATUSES.filter(
    (_status, index) => index < currentIndex || index === currentIndex + 1,
  );
}

/** How an incident was first reported (docs/modules/10 §3). */
export const INCIDENT_SOURCES = ['phone', 'report_doc', 'monitoring', 'other'] as const;
export type IncidentSource = (typeof INCIDENT_SOURCES)[number];

/** Deployed forces & assets kind (app.incident_resources). */
export const INCIDENT_RESOURCE_KINDS = ['personnel', 'vehicle', 'equipment', 'aviation'] as const;
export type IncidentResourceKind = (typeof INCIDENT_RESOURCE_KINDS)[number];

/** Severity scale sev-1..5 (docs/06 design-system; objectowy…transboundary). */
export const INCIDENT_SEVERITY_MIN = 1;
export const INCIDENT_SEVERITY_MAX = 5;

/** Layer registry kinds (gis.layers): built-in, ogr2ogr-imported, web-drawn. */
export const GIS_LAYER_KINDS = ['system', 'imported', 'drawn'] as const;
export type GisLayerKind = (typeof GIS_LAYER_KINDS)[number];

/** geo-import job lifecycle (app.gis_imports). */
export const GIS_IMPORT_STATUSES = ['pending', 'processing', 'done', 'failed'] as const;
export type GisImportStatus = (typeof GIS_IMPORT_STATUSES)[number];

/** geo-export job lifecycle (app.gis_exports) — same states as the import. */
export const GIS_EXPORT_STATUSES = GIS_IMPORT_STATUSES;
export type GisExportStatus = GisImportStatus;

/** What a geo-export renders (docs/modules/10 §6: «любой слой/выборка ЧС»). */
export const GIS_EXPORT_SOURCES = ['layer', 'incidents'] as const;
export type GisExportSource = (typeof GIS_EXPORT_SOURCES)[number];

/** Export formats (docs/modules/10 §6). GPKG/SHP/GeoJSON keep the geometry; CSV
 *  carries it as WKT; XLSX is the flat attribute table for office reports. */
export const GIS_EXPORT_FORMATS = ['geojson', 'gpkg', 'shp', 'csv', 'xlsx'] as const;
export type GisExportFormat = (typeof GIS_EXPORT_FORMATS)[number];

/** Formats a geo-import accepts (docs/modules/10 §6). A shapefile arrives zipped
 *  because it is a set of sidecar files, not one. */
export const GIS_IMPORT_FORMATS = ['geojson', 'zip', 'kml', 'gpkg', 'csv'] as const;
export type GisImportFormat = (typeof GIS_IMPORT_FORMATS)[number];

/** PostGIS geometry types used across the platform (layer geometry_type + the
 *  Drizzle `geometry()` column helper). Values match PostGIS type modifiers. */
export const GEOMETRY_TYPES = [
  'Point',
  'LineString',
  'Polygon',
  'MultiPoint',
  'MultiLineString',
  'MultiPolygon',
  'GeometryCollection',
  'Geometry',
] as const;
export type GeometryType = (typeof GEOMETRY_TYPES)[number];

/** PostGIS access accounts for QGIS/ArcGIS (docs/modules/10 §7, task 2.9). A
 *  `reader` gets SELECT on schema `gis`; an `editor` also gets write (WFS-T). */
export const GIS_DB_ACCOUNT_KINDS = ['reader', 'editor'] as const;
export type GisDbAccountKind = (typeof GIS_DB_ACCOUNT_KINDS)[number];

/** Publication state of a registry layer to GeoServer WMS/WFS (docs/modules/10 §7). */
export const GIS_PUBLISH_STATES = ['unpublished', 'published', 'error'] as const;
export type GisPublishState = (typeof GIS_PUBLISH_STATES)[number];

// --- Docflow (docs/modules/11, phase 3) ---

/** Registration-journal document class (docs/modules/11 §3): the registration
 *  books are grouped by the direction of the document flow. */
export const DOC_CLASSES = ['incoming', 'outgoing', 'internal', 'citizens'] as const;
export type DocClass = (typeof DOC_CLASSES)[number];

/** How a journal's registration sequence resets (docs/modules/11 §3). `yearly` is
 *  the norm (numbers restart each year); `never` is a continuous book. */
export const JOURNAL_SEQ_RESETS = ['yearly', 'never'] as const;
export type JournalSeqReset = (typeof JOURNAL_SEQ_RESETS)[number];

/** Document lifecycle (docs/modules/11 §3/§4). `draft → on_route → pending_registration
 *  → registered → in_progress → completed → archived`, with `rejected` (a route step
 *  rejected it, back to the author) and `recalled` (the author withdrew it). */
export const DOCUMENT_STATUSES = [
  'draft',
  'on_route',
  'pending_registration',
  'registered',
  'in_progress',
  'completed',
  'archived',
  'rejected',
  'recalled',
] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

/**
 * Allowed manual (`changeStatus`) transitions (docs/modules/11 §4). Several statuses
 * are reached only through dedicated actions, never a plain status change, so they are
 * NOT targets here: `registered` (the `register` action, which mints the number), and
 * `on_route` / `pending_registration` (the route engine — start moves draft→on_route,
 * completion moves on_route→pending_registration, rejection moves on_route→draft).
 * What remains manual is the execution/filing tail and rework back-edges.
 */
export const DOCUMENT_STATUS_TRANSITIONS: Record<DocumentStatus, readonly DocumentStatus[]> = {
  draft: [],
  on_route: [],
  pending_registration: ['rejected'],
  registered: ['in_progress', 'archived'],
  in_progress: ['completed'],
  completed: ['archived'],
  rejected: ['draft', 'recalled'],
  recalled: ['draft'],
  archived: [],
};

/** True if `to` is a permitted next status from `from` (docs/modules/11 §4). */
export function documentTransitionAllowed(from: DocumentStatus, to: DocumentStatus): boolean {
  return DOCUMENT_STATUS_TRANSITIONS[from].includes(to);
}

/** Confidentiality grade (docs/modules/11 §3). `dsp` = restricted (allow-list only). */
export const DOCUMENT_CONFIDENTIALITY = ['normal', 'dsp'] as const;
export type DocumentConfidentiality = (typeof DOCUMENT_CONFIDENTIALITY)[number];

/** How an outgoing document is dispatched (docs/modules/11 §3). */
export const DOCUMENT_DELIVERY = ['mail', 'email', 'courier', 'fax'] as const;
export type DocumentDelivery = (typeof DOCUMENT_DELIVERY)[number];

/** A document file's role (docs/modules/11 §3): the main body vs an attachment. */
export const DOCUMENT_FILE_KINDS = ['main', 'attachment'] as const;
export type DocumentFileKind = (typeof DOCUMENT_FILE_KINDS)[number];

// --- Document routes (docs/modules/11 §3/§4, task 3.3) ---

/** A route's lifecycle (docs/modules/11 §3). One active route per document at a time;
 *  a rejected/relaunched route is kept as history (`cycle`). */
export const ROUTE_STATUSES = ['active', 'completed', 'cancelled'] as const;
export type RouteStatus = (typeof ROUTE_STATUSES)[number];

/** What a route step asks of its assignee (docs/modules/11 §3). Task 3.3 acts on
 *  `approve`; `sign` lands in 3.5, `acknowledge` in 3.6. */
export const ROUTE_STEP_KINDS = ['approve', 'sign', 'register', 'acknowledge', 'execute'] as const;
export type RouteStepKind = (typeof ROUTE_STEP_KINDS)[number];

/** Steps sharing an `order` form a parallel group; groups run sequentially. `mode`
 *  is descriptive — activation is driven by the order grouping (docs/modules/11 §3). */
export const ROUTE_STEP_MODES = ['sequential', 'parallel'] as const;
export type RouteStepMode = (typeof ROUTE_STEP_MODES)[number];

/** A step's state (docs/modules/11 §3). */
export const ROUTE_STEP_STATUSES = ['pending', 'active', 'done', 'rejected', 'skipped'] as const;
export type RouteStepStatus = (typeof ROUTE_STEP_STATUSES)[number];

/** The recorded decision on an acted step (docs/modules/11 §3). */
export const ROUTE_STEP_DECISIONS = ['approved', 'rejected', 'signed', 'acknowledged'] as const;
export type RouteStepDecision = (typeof ROUTE_STEP_DECISIONS)[number];

/** Who a step is assigned to (docs/modules/11 §3): a user, a position, or an org unit. */
export const ROUTE_ASSIGNEE_TYPES = ['user', 'position', 'org_unit'] as const;
export type RouteAssigneeType = (typeof ROUTE_ASSIGNEE_TYPES)[number];

/** Resolution lifecycle (docs/modules/11 §3): an issued instruction is `active` until
 *  the executor reports it `done`, or the author `cancelled` it. */
export const RESOLUTION_STATUSES = ['active', 'done', 'cancelled'] as const;
export type ResolutionStatus = (typeof RESOLUTION_STATUSES)[number];

// --- Digital signatures / ЭЦП (docs/09-security.md §4, task 3.5) ---

/** What a signature attests (docs/09-security.md §4): a route approval (`approve`), a
 *  full signing (`sign`), or a lightweight acknowledgement (`acknowledge`, task 3.6). */
export const SIGNATURE_CONTEXTS = ['approve', 'sign', 'acknowledge'] as const;
export type SignatureContext = (typeof SIGNATURE_CONTEXTS)[number];

/** The only signature algorithm (docs/09-security.md §4): ECDSA P-256 over SHA-256.
 *  A second (state qualified) type may be added in v2. */
export const SIGNATURE_ALGORITHMS = ['ECDSA_P256_SHA256'] as const;
export type SignatureAlgorithm = (typeof SIGNATURE_ALGORITHMS)[number];

/** A certificate's role (docs/09-security.md §4). User certificates are `device` — one
 *  per device, each with its own key; the CA root lives in the `ca_data` volume, not this
 *  table. `kind` leaves room for future certificate classes. */
export const CERTIFICATE_KINDS = ['device'] as const;
export type CertificateKind = (typeof CERTIFICATE_KINDS)[number];

// --- Document links / связи (docs/modules/11 §3, task 3.7) ---

/** How two documents relate (docs/modules/11 §3): a generic association, or a reply
 *  (`reply` = the source document answers the target). Shown bidirectionally on both cards. */
export const DOCUMENT_LINK_KINDS = ['related', 'reply'] as const;
export type DocumentLinkKind = (typeof DOCUMENT_LINK_KINDS)[number];

// --- Execution control / контроль (docs/modules/11 §5, task 3.8) ---

/** Deadline severity for the «На контроле» color scale (docs/modules/11 §5): more than
 *  3 days out = `normal`, within 3 days = `warning`, past due = `overdue`. */
export const CONTROL_SEVERITIES = ['normal', 'warning', 'overdue'] as const;
export type ControlSeverity = (typeof CONTROL_SEVERITIES)[number];

/** Substitution scope (docs/05-auth-rbac.md §6, task 3.11): `all` covers routes + resolutions;
 *  `docflow` is the same set today (kept distinct for future non-docflow delegations). */
export const SUBSTITUTION_SCOPES = ['all', 'docflow'] as const;
export type SubstitutionScope = (typeof SUBSTITUTION_SCOPES)[number];

/** Display timezone is Asia/Dushanbe (UTC+5, no DST) — deadline day boundaries are local. */
const DUSHANBE_OFFSET_MS = 5 * 60 * 60 * 1000;

/** The Asia/Dushanbe calendar day of a UTC instant, as a day number (floored). */
function dushanbeDay(ms: number): number {
  return Math.floor((ms + DUSHANBE_OFFSET_MS) / 86_400_000);
}

/** Whole Asia/Dushanbe calendar days from `now` until `due` (negative = overdue). */
export function deadlineDaysLeft(dueIso: string, now: Date): number {
  return dushanbeDay(new Date(dueIso).getTime()) - dushanbeDay(now.getTime());
}

export function deadlineSeverity(dueIso: string | null, now: Date): ControlSeverity {
  if (!dueIso) return 'normal';
  const days = deadlineDaysLeft(dueIso, now);
  if (days < 0) return 'overdue';
  if (days <= 3) return 'warning';
  return 'normal';
}

export interface DeadlineClassification {
  severity: ControlSeverity;
  /** A pre-due reminder day (−3 / −1 / 0), else null. */
  reminder: 'due3' | 'due1' | 'due0' | null;
  /** Past due (fires an overdue reminder daily). */
  overdue: boolean;
  /** Overdue by more than 5 days (escalation to the subdivision head). */
  escalation: boolean;
}

/**
 * Classify a controlled deadline for the daily sweep (docs/modules/11 §5). Reminders go
 * out at 3 days, 1 day and on the due day; once overdue, an overdue reminder fires every
 * day, and past 5 days overdue it escalates. Pure + timezone-correct (Dushanbe days) so
 * the worker and its tests agree.
 */
export function classifyDeadline(dueIso: string, now: Date): DeadlineClassification {
  const days = deadlineDaysLeft(dueIso, now);
  return {
    severity: days < 0 ? 'overdue' : days <= 3 ? 'warning' : 'normal',
    reminder: days === 3 ? 'due3' : days === 1 ? 'due1' : days === 0 ? 'due0' : null,
    overdue: days < 0,
    escalation: days <= -6,
  };
}
