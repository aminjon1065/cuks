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
