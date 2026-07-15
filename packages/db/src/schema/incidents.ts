import { sql } from 'drizzle-orm';
import {
  check,
  customType,
  index,
  integer,
  jsonb,
  numeric,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  GIS_DB_ACCOUNT_KINDS,
  GIS_EXPORT_FORMATS,
  GIS_EXPORT_SOURCES,
  GIS_EXPORT_STATUSES,
  GIS_IMPORT_STATUSES,
  INCIDENT_RESOURCE_KINDS,
  INCIDENT_SOURCES,
  INCIDENT_STATUSES,
} from '@cuks/shared';
import { appSchema, createdAt, deletedAt, primaryId, updatedAt } from './_shared';
import { fsNodes } from './fs';
import { adminUnits, geometry, gisLayers } from './gis';
import { orgUnits } from './org';
import { users } from './users';

/** FTS vector (docs/07 §Поиск, config `russian`); generated, GIN-indexed. */
const tsvector = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'tsvector';
  },
});

/**
 * app.incidents — the emergency registry (docs/modules/10 §3). Geometry is a
 * Point (usual) or Polygon (area event) in 4326. Region/district/jamoat are
 * resolved from the point (phase 2.5) and reference gis.admin_units. Casualty and
 * damage figures are the last-confirmed snapshot — changed only via a new
 * incident_report (docs/modules/10 §5), never edited in place. Money is `numeric`
 * (CLAUDE.md §2 — never float). Soft-deleted.
 */
export const incidents = appSchema.table(
  'incidents',
  {
    id: primaryId(),
    number: text('number').notNull(),
    typeCode: text('type_code').notNull(),
    severity: integer('severity').notNull(),
    status: text('status', { enum: INCIDENT_STATUSES }).notNull().default('reported'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    reportedAt: timestamp('reported_at', { withTimezone: true }).notNull().defaultNow(),
    regionId: uuid('region_id').references(() => adminUnits.id, { onDelete: 'set null' }),
    districtId: uuid('district_id').references(() => adminUnits.id, { onDelete: 'set null' }),
    jamoatId: uuid('jamoat_id').references(() => adminUnits.id, { onDelete: 'set null' }),
    geom: geometry('geom', 'Geometry').notNull(),
    addressText: text('address_text'),
    description: text('description'),
    source: text('source', { enum: INCIDENT_SOURCES }).notNull().default('phone'),
    dead: integer('dead').notNull().default(0),
    injured: integer('injured').notNull().default(0),
    evacuated: integer('evacuated').notNull().default(0),
    affected: integer('affected').notNull().default(0),
    damageEst: numeric('damage_est', { precision: 18, scale: 2 }),
    damageNote: text('damage_note'),
    orgUnitId: uuid('org_unit_id').references(() => orgUnits.id, { onDelete: 'set null' }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    closedBy: uuid('closed_by').references(() => users.id, { onDelete: 'set null' }),
    // FTS over number + description + address (docs/modules/10 §3).
    searchTsv: tsvector('search_tsv').generatedAlwaysAs(
      sql`to_tsvector('russian', "number" || ' ' || coalesce("description", '') || ' ' || coalesce("address_text", ''))`,
    ),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    uniqueIndex('incidents_number_uq').on(t.number),
    index('incidents_status_idx').on(t.status),
    index('incidents_type_idx').on(t.typeCode),
    index('incidents_region_idx').on(t.regionId),
    index('incidents_district_idx').on(t.districtId),
    index('incidents_occurred_idx').on(t.occurredAt),
    index('incidents_geom_gix').using('gist', t.geom),
    index('incidents_search_tsv_idx').using('gin', t.searchTsv),
    check('incidents_severity_chk', sql`${t.severity} between 1 and 5`),
    check('incidents_reported_after_occurrence_chk', sql`${t.reportedAt} >= ${t.occurredAt}`),
    check(
      'incidents_status_chk',
      sql`${t.status} in ('reported', 'active', 'localized', 'eliminated', 'closed')`,
    ),
    check('incidents_closed_at_chk', sql`(${t.status} = 'closed') = (${t.closedAt} is not null)`),
    check(
      'incidents_source_chk',
      sql`${t.source} in ('phone', 'report_doc', 'monitoring', 'other')`,
    ),
  ],
);

/** app.incident_reports — time-ordered situation reports on an incident, each a
 *  casualty snapshot (docs/modules/10 §3). */
export const incidentReports = appSchema.table(
  'incident_reports',
  {
    id: primaryId(),
    incidentId: uuid('incident_id')
      .notNull()
      .references(() => incidents.id, { onDelete: 'cascade' }),
    reportedAt: timestamp('reported_at', { withTimezone: true }).notNull().defaultNow(),
    text: text('text'),
    dead: integer('dead'),
    injured: integer('injured'),
    evacuated: integer('evacuated'),
    affected: integer('affected'),
    damageEst: numeric('damage_est', { precision: 18, scale: 2 }),
    damageNote: text('damage_note'),
    authorId: uuid('author_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    index('incident_reports_incident_idx').on(t.incidentId, t.reportedAt),
    // The operational-summary feed lists the newest reports across all incidents
    // (docs/modules/10 §8); a plain btree scanned backwards serves `order by
    // reported_at desc limit N`.
    index('incident_reports_reported_idx').on(t.reportedAt),
  ],
);

/** app.incident_resources — forces & assets deployed to an incident
 *  (docs/modules/10 §3). */
export const incidentResources = appSchema.table(
  'incident_resources',
  {
    id: primaryId(),
    incidentId: uuid('incident_id')
      .notNull()
      .references(() => incidents.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: INCIDENT_RESOURCE_KINDS }).notNull(),
    name: text('name').notNull(),
    qty: integer('qty').notNull().default(1),
    orgText: text('org_text'),
    period: text('period'),
    createdAt: createdAt(),
  },
  (t) => [
    index('incident_resources_incident_idx').on(t.incidentId),
    check(
      'incident_resources_kind_chk',
      sql`${t.kind} in ('personnel', 'vehicle', 'equipment', 'aviation')`,
    ),
  ],
);

/**
 * app.gis_imports — geo-import job records (docs/modules/10 §3, §6). The uploaded
 * source object lives in S3 under `storage_key` (the wizard uploads it straight
 * there, presigned, like every other upload); `file_id` stays null unless the
 * source was picked from the file registry. `preview` holds what the wizard shows
 * after the worker has read the file: fields, feature count, extent, geometry type.
 */
export const gisImports = appSchema.table(
  'gis_imports',
  {
    id: primaryId(),
    fileId: uuid('file_id').references(() => fsNodes.id, { onDelete: 'set null' }),
    layerId: uuid('layer_id').references(() => gisLayers.id, { onDelete: 'set null' }),
    status: text('status', { enum: GIS_IMPORT_STATUSES }).notNull().default('pending'),
    /** S3 key of the uploaded source file. */
    storageKey: text('storage_key'),
    /** Original file name, as the user picked it (shown in the wizard). */
    sourceName: text('source_name'),
    /** Declared byte size, checked against the object before the job is queued. */
    sizeBytes: integer('size_bytes'),
    log: text('log'),
    preview: jsonb('preview'),
    options: jsonb('options')
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [
    check(
      'gis_imports_status_chk',
      sql`${t.status} in ('pending', 'processing', 'done', 'failed')`,
    ),
    index('gis_imports_created_by_idx').on(t.createdBy, t.createdAt),
  ],
);

/**
 * app.gis_exports — geo-export job records (docs/modules/10 §6). A layer or a
 * selection of incidents is rendered by the worker into one of the export formats,
 * uploaded to S3 and announced with a notification carrying the download link.
 */
export const gisExports = appSchema.table(
  'gis_exports',
  {
    id: primaryId(),
    source: text('source', { enum: GIS_EXPORT_SOURCES }).notNull(),
    format: text('format', { enum: GIS_EXPORT_FORMATS }).notNull(),
    /** Which layer, or the incident filters — the same shape the registry uses. */
    params: jsonb('params')
      .notNull()
      .default(sql`'{}'::jsonb`),
    status: text('status', { enum: GIS_EXPORT_STATUSES }).notNull().default('pending'),
    storageKey: text('storage_key'),
    fileName: text('file_name'),
    sizeBytes: integer('size_bytes'),
    featureCount: integer('feature_count'),
    error: text('error'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [
    check(
      'gis_exports_status_chk',
      sql`${t.status} in ('pending', 'processing', 'done', 'failed')`,
    ),
    check('gis_exports_source_chk', sql`${t.source} in ('layer', 'incidents')`),
    check('gis_exports_format_chk', sql`${t.format} in ('geojson', 'gpkg', 'shp', 'csv', 'xlsx')`),
    index('gis_exports_created_by_idx').on(t.createdBy, t.createdAt),
  ],
);

/**
 * app.gis_db_accounts — registry of managed PostgreSQL login roles for direct
 * QGIS/ArcGIS access (docs/modules/10 §7, docs/09 §Права PG; task 2.9). Lives in
 * `app`, NOT `gis`: the roles it tracks are granted the whole `gis` schema, so
 * keeping the registry there would let an issued account read (or, for an editor,
 * tamper with) the list of all accounts. One row per issued role; the password is
 * never stored — it is shown once and cannot be recovered.
 */
export const gisDbAccounts = appSchema.table(
  'gis_db_accounts',
  {
    id: primaryId(),
    /** The `pg_roles` name — always `cuks_gis_<label>`. */
    username: text('username').notNull(),
    kind: text('kind', { enum: GIS_DB_ACCOUNT_KINDS }).notNull(),
    note: text('note'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('gis_db_accounts_username_uq').on(t.username),
    check('gis_db_accounts_kind_chk', sql`${t.kind} in ('reader', 'editor')`),
  ],
);
